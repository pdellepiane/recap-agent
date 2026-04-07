import { ulid } from 'ulid';

import type { DecisionNode } from '../core/decision-nodes';
import { extractionPersistenceNodes } from '../core/decision-nodes';
import { resolveResumeNode } from '../core/decision-flow';
import type {
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
} from '../core/messages';
import {
  createEmptyPlan,
  mergePlan,
  type PersistedPlan,
  type PlanSnapshot,
} from '../core/plan';
import type { ProviderSummary } from '../core/provider';
import { computeSearchSufficiency } from '../core/sufficiency';
import type { TurnTrace } from '../core/trace';
import type { AgentRuntime, ExtractionResult } from './contracts';
import type { PromptLoader } from './prompt-loader';
import type { ProviderGateway } from './provider-gateway';
import type { PlanStore } from '../storage/plan-store';

export type HandleTurnResponse = {
  plan: PlanSnapshot;
  outbound: NormalizedOutboundMessage;
  trace: TurnTrace;
};

export class AgentService {
  constructor(
    private readonly dependencies: {
      planStore: PlanStore;
      runtime: AgentRuntime;
      providerGateway: ProviderGateway;
      promptLoader: PromptLoader;
    },
  ) {}

  async handleTurn(
    inbound: NormalizedInboundMessage,
  ): Promise<HandleTurnResponse> {
    const existingPlan = await this.dependencies.planStore.getByExternalUser(
      inbound.channel,
      inbound.externalUserId,
    );

    const previousNode = existingPlan?.current_node ?? 'contacto_inicial';
    const loadedPlan =
      existingPlan ??
      createEmptyPlan({
        planId: ulid(),
        channel: inbound.channel,
        externalUserId: inbound.externalUserId,
      });

    const workingPlan = mergePlan(loadedPlan, {
      current_node: existingPlan ? resolveResumeNode(existingPlan) : 'deteccion_intencion',
    });

    const extraction = await this.dependencies.runtime.extract({
      userMessage: inbound.text,
      plan: workingPlan,
    });

    const extractionNode = this.resolveExtractionNode(workingPlan, extraction);
    const mergedPlan = this.applyExtraction(workingPlan, extraction, extractionNode);
    const sufficiency = computeSearchSufficiency(mergedPlan);

    const nodePath: DecisionNode[] = existingPlan
      ? [previousNode, 'existe_plan_guardado', extractionNode]
      : [previousNode, extractionNode];
    let currentNode = extractionNode;
    let providerResults: ProviderSummary[] = mergedPlan.recommended_providers;
    let errorMessage: string | null = null;
    let planPersistReason: string | null = null;
    let planPersisted = false;

    if (extraction.pauseRequested || extraction.intent === 'pausar' || extraction.intent === 'cerrar') {
      currentNode = 'guardar_cerrar_temporalmente';
      nodePath.push(currentNode);
      const planToSave = mergePlan(mergedPlan, { current_node: currentNode });
      await this.dependencies.planStore.save({
        plan: planToSave,
        reason: 'guardar_cerrar_temporalmente',
      });
      planPersisted = true;
      planPersistReason = 'guardar_cerrar_temporalmente';

      const bundle = await this.dependencies.promptLoader.loadNodeBundle(currentNode);
      const reply = await this.dependencies.runtime.composeReply({
        currentNode,
        previousNode,
        userMessage: inbound.text,
        plan: planToSave,
        missingFields: sufficiency.missingFields,
        searchReady: sufficiency.searchReady,
        providerResults,
        errorMessage,
        promptBundleId: bundle.id,
        promptFilePaths: bundle.filePaths,
        toolUsage: { considered: [], called: [] },
      });

      await this.dependencies.planStore.save({
        plan: planToSave,
        reason: planPersistReason ?? currentNode,
      });

      return {
        plan: planToSave,
        outbound: {
          text: reply.text,
          conversationId: planToSave.conversation_id,
        },
        trace: {
          trace_id: ulid(),
          conversation_id: planToSave.conversation_id,
          plan_id: planToSave.plan_id,
          previous_node: previousNode,
          next_node: currentNode,
          node_path: nodePath,
          intent: planToSave.intent,
          missing_fields: sufficiency.missingFields,
          search_ready: sufficiency.searchReady,
          prompt_bundle_id: bundle.id,
          prompt_file_paths: bundle.filePaths,
          tools_considered: [],
          tools_called: [],
          plan_persisted: true,
          plan_persist_reason: planPersistReason,
        },
      };
    }

    if (extractionPersistenceNodes.has(extractionNode)) {
      await this.dependencies.planStore.save({
        plan: mergedPlan,
        reason: extractionNode,
      });
      planPersisted = true;
      planPersistReason = extractionNode;
    }

    let planAfterFlow = mergedPlan;

    if (!sufficiency.searchReady) {
      currentNode = 'aclarar_pedir_faltante';
      nodePath.push('minimos_para_buscar', currentNode);
      planAfterFlow = mergePlan(mergedPlan, {
        current_node: currentNode,
        missing_fields: sufficiency.missingFields,
      });
    } else if (this.tryResolveSelection(planAfterFlow, extraction.selectedProviderHint)) {
      currentNode = 'anadir_a_proveedores_recomendados';
      nodePath.push('usuario_elige_proveedor', currentNode, 'seguir_refinando_guardar_plan');
      currentNode = 'seguir_refinando_guardar_plan';
      planAfterFlow = mergePlan(planAfterFlow, {
        current_node: currentNode,
      });
      await this.dependencies.planStore.save({
        plan: planAfterFlow,
        reason: 'seguir_refinando_guardar_plan',
      });
      planPersisted = true;
      planPersistReason = 'seguir_refinando_guardar_plan';
    } else {
      nodePath.push('minimos_para_buscar', 'buscar_proveedores');
      try {
        const searchResult = await this.dependencies.providerGateway.searchProviders(
          planAfterFlow,
        );
        providerResults = searchResult.providers;
        planAfterFlow = mergePlan(planAfterFlow, {
          recommended_provider_ids: providerResults.map((provider) => provider.id),
          recommended_providers: providerResults,
        });

        nodePath.push('busqueda_exitosa');
        if (providerResults.length === 0) {
          currentNode = 'refinar_criterios';
          nodePath.push('hay_resultados', currentNode);
          planAfterFlow = mergePlan(planAfterFlow, {
            current_node: currentNode,
          });
        } else {
          currentNode = 'recomendar';
          nodePath.push('hay_resultados', currentNode);
          planAfterFlow = mergePlan(planAfterFlow, {
            current_node: currentNode,
          });
        }

        await this.dependencies.planStore.save({
          plan: planAfterFlow,
          reason: currentNode,
        });
        planPersisted = true;
        planPersistReason = currentNode;
      } catch (error) {
        errorMessage =
          error instanceof Error ? error.message : 'Unknown provider search error.';
        currentNode = 'informar_error_reintento';
        nodePath.push('busqueda_exitosa', currentNode);
        planAfterFlow = mergePlan(planAfterFlow, {
          current_node: currentNode,
        });
        await this.dependencies.planStore.save({
          plan: planAfterFlow,
          reason: currentNode,
        });
        planPersisted = true;
        planPersistReason = currentNode;
      }
    }

    const promptBundle = await this.dependencies.promptLoader.loadNodeBundle(
      currentNode,
    );
    const toolUsage = { considered: [] as string[], called: [] as string[] };
    const reply = await this.dependencies.runtime.composeReply({
      currentNode,
      previousNode,
      userMessage: inbound.text,
      plan: planAfterFlow,
      missingFields: sufficiency.missingFields,
      searchReady: sufficiency.searchReady,
      providerResults,
      errorMessage,
      promptBundleId: promptBundle.id,
      promptFilePaths: promptBundle.filePaths,
      toolUsage,
    });

    await this.dependencies.planStore.save({
      plan: planAfterFlow,
      reason: planPersistReason ?? currentNode,
    });

    return {
      plan: planAfterFlow,
      outbound: {
        text: reply.text,
        conversationId: planAfterFlow.conversation_id,
      },
      trace: {
        trace_id: ulid(),
        conversation_id: planAfterFlow.conversation_id,
        plan_id: planAfterFlow.plan_id,
        previous_node: previousNode,
        next_node: currentNode,
        node_path: nodePath,
        intent: planAfterFlow.intent,
        missing_fields: sufficiency.missingFields,
        search_ready: sufficiency.searchReady,
        prompt_bundle_id: promptBundle.id,
        prompt_file_paths: promptBundle.filePaths,
        tools_considered: toolUsage.considered,
        tools_called: toolUsage.called,
        plan_persisted: planPersisted,
        plan_persist_reason: planPersistReason,
      },
    };
  }

  private resolveExtractionNode(
    plan: PersistedPlan,
    extraction: ExtractionResult,
  ): DecisionNode {
    if (!plan.intent) {
      return 'deteccion_intencion';
    }

    if (extraction.intent === 'refinar_busqueda') {
      return 'refinar_criterios';
    }

    if (extraction.intent === 'confirmar_proveedor') {
      return 'usuario_elige_proveedor';
    }

    if ((plan.missing_fields ?? []).length > 0) {
      return 'aclarar_pedir_faltante';
    }

    return 'entrevista';
  }

  private applyExtraction(
    plan: PlanSnapshot,
    extraction: ExtractionResult,
    extractionNode: DecisionNode,
  ): PlanSnapshot {
    const candidate = mergePlan(plan, {
      current_node: extractionNode,
      intent: extraction.intent,
      intent_confidence: extraction.intentConfidence,
      event_type: extraction.eventType,
      vendor_category: extraction.vendorCategory,
      location: extraction.location,
      budget_signal: extraction.budgetSignal,
      guest_range: extraction.guestRange,
      preferences: extraction.preferences,
      hard_constraints: extraction.hardConstraints,
      assumptions: extraction.assumptions,
      conversation_summary: extraction.conversationSummary,
      selected_provider_hint: extraction.selectedProviderHint,
    });

    const sufficiency = computeSearchSufficiency(candidate);
    return mergePlan(candidate, {
      missing_fields: sufficiency.missingFields,
    });
  }

  private tryResolveSelection(
    plan: PlanSnapshot,
    selectedProviderHint: string | null,
  ): boolean {
    if (!selectedProviderHint || plan.recommended_providers.length === 0) {
      return false;
    }

    const numericChoice = Number.parseInt(selectedProviderHint, 10);
    let selected = Number.isFinite(numericChoice)
      ? plan.recommended_providers[numericChoice - 1]
      : null;

    if (!selected) {
      const lowered = selectedProviderHint.toLowerCase();
      selected =
        plan.recommended_providers.find((provider) =>
        provider.title.toLowerCase().includes(lowered),
      ) ?? null;
    }

    if (!selected) {
      return false;
    }

    plan.selected_provider_id = selected.id;
    plan.selected_provider_hint = selectedProviderHint;
    plan.current_node = 'usuario_elige_proveedor';
    return true;
  }
}
