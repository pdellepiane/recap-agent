import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { decisionNodes, type DecisionNode } from '../core/decision-nodes';
import type { PromptBundle, PromptLoader } from '../runtime/prompt-loader';
import {
  conversationPromptFilesForNode,
  extractorPromptFilesForCapabilities,
  nodePromptManifest,
  responseClassifierPromptFiles,
} from '../runtime/prompt-manifest';
import { extractorAuditProfiles } from './prompt-audit';

const execFileAsync = promisify(execFile);

export type BranchCallType = 'classifier' | 'extraction' | 'reply';

export type BranchMeasurement = {
  branchId: string;
  route: string;
  callType: BranchCallType;
  component: BranchCallType;
  fileCount: number;
  filePaths: string[];
  instructionBytes: number;
  inputBytes: number;
  serializedRequestBytes: number;
  toolCount: number;
  schemaPropertyCount: number;
  description: string;
};

export type BranchBaseline = {
  anchorRef: string;
  generatedAt: string;
  counterModel: string;
  branches: BranchMeasurement[];
  summary: {
    totalInstructionBytes: number;
    totalInputBytes: number;
    totalSerializedRequestBytes: number;
  };
};

type HistoricalReader = (ref: string, relativePath: string) => Promise<string>;

async function readHistoricalPrompt(ref: string, relativePath: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['show', `${ref}:prompts/${relativePath}`], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

function buildBundleFromContents(
  relativePaths: readonly string[],
  contents: Map<string, string>,
  allowedTools: readonly string[],
): PromptBundle {
  const instructions = relativePaths
    .map((relativePath) => {
      const content = contents.get(relativePath) ?? '';
      return `## ${relativePath}\n${content.trim()}`;
    })
    .join('\n\n');
  return {
    id: `git:bundle:${relativePaths.join(',')}`,
    filePaths: [...relativePaths],
    ruleIds: [],
    instructions,
    allowedTools: allowedTools as PromptBundle['allowedTools'],
  };
}

function measureBundle(args: {
  bundle: PromptBundle;
  route: string;
  input: string;
  counterModel: string;
  toolCount: number;
  schemaPropertyCount: number;
}): BranchMeasurement {
  const instructionBytes = Buffer.byteLength(args.bundle.instructions, 'utf8');
  const inputBytes = Buffer.byteLength(args.input, 'utf8');
  const candidate = {
    model: args.counterModel,
    instructions: args.bundle.instructions,
    input: args.input,
    reasoning: { effort: 'none' as const },
    text: { verbosity: 'low' as const },
  };
  const serializedRequestBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
  return {
    branchId: args.route,
    route: args.route,
    callType: 'reply',
    component: 'reply',
    fileCount: args.bundle.filePaths.length,
    filePaths: [...args.bundle.filePaths],
    instructionBytes,
    inputBytes,
    serializedRequestBytes,
    toolCount: args.toolCount,
    schemaPropertyCount: args.schemaPropertyCount,
    description: `Serialized via buildRequestMetrics semantics: instructionBytes/inputBytes from Buffer.byteLength, serializedRequestBytes from JSON.stringify(candidate)`,
  };
}

export function sampleInputForBranch(branchId: string): string {
  if (branchId === 'classifier') {
    return JSON.stringify({
      inbound_message: 'Hola, quiero planear un evento para 50 personas',
      plan_context: {
        current_node: 'contacto_inicial',
        active_need_category: null,
        human_escalation_status: 'none',
        conversation_health: { help_offer_status: 'none', stalled_turns: 0 },
        rsvp_state: { status: 'none' },
        conversation_summary: 'Plan inicial sin contexto',
      },
      has_prior_outbound_message: false,
      recent_messages: [],
    });
  }
  if (branchId === 'classifier:campaign_reply') {
    return JSON.stringify({
      inbound_message: 'Confirmo que si asistire',
      decision_context: {
        profile: 'campaign_reply',
        rsvp_status: 'none',
        human_help_offer_status: 'none',
      },
      campaign_message: {
        direction: 'outbound',
        source: 'admin_campaign',
        body: 'Hola, te invitamos a confirmar tu asistencia al evento Paolo y Mariana el 2026-09-15',
      },
    });
  }
  if (branchId.startsWith('extractor:')) {
    const profile = branchId.replace('extractor:', '');
    return [
      'Estado del historial: available.',
      `Historial reciente visible (JSON): []`,
      `Mensaje del usuario: ${profile === 'rsvp' ? 'Confirmo mi asistencia' : 'Hola, necesito un catering en Miraflores'}`,
      `Plan base (JSON compacto): {"current_node":"entrevista","event_type":"matrimonio","active_need_category":null}`,
      `Acciones disponibles en este turno: ${profile}: acciones tipicas del perfil`,
      'Extrae solo cambios nuevos del turno.',
    ].join('\n');
  }
  if (branchId.startsWith('responder_invitacion')) {
    if (branchId === 'responder_invitacion:resolved_single') {
      return buildReplyInputForRsvpBranch('resolved_single');
    }
    if (branchId === 'responder_invitacion:needs_event_selection') {
      return buildReplyInputForRsvpBranch('needs_event_selection');
    }
    if (branchId === 'responder_invitacion:unavailable') {
      return buildReplyInputForRsvpBranch('unavailable');
    }
  }
  // Generic reply branch
  return `Evidencia canónica del turno (JSON): ${JSON.stringify(sampleGenericReplyEvidence(branchId), null, 2)}`;
}

function buildReplyInputForRsvpBranch(
  state: 'resolved_single' | 'needs_event_selection' | 'unavailable',
): string {
  let rsvpEvidence: unknown;
  if (state === 'resolved_single') {
    rsvpEvidence = {
      state: 'resolved_single',
      coverage: 'complete' as const,
      resolution: 'authoritative_invitation' as const,
      event: {
        event_name: 'Paolo y Mariana',
        event_date: '2026-09-15',
        rsvp_state: 'pending',
        invitation_record: 'available',
      },
    };
  } else if (state === 'needs_event_selection') {
    rsvpEvidence = {
      state: 'needs_event_selection',
      coverage: 'complete' as const,
      resolution: 'event_association_only' as const,
      candidates: [
        {
          event_name: 'Paolo y Mariana',
          event_date: '2026-09-15',
          rsvp_state: 'pending',
          invitation_record: 'available',
        },
        {
          event_name: 'Evento Corporativo Q4',
          event_date: '2026-10-02',
          rsvp_state: 'pending',
          invitation_record: 'available',
        },
      ],
    };
  } else {
    rsvpEvidence = {
      state: 'unavailable',
      coverage: 'complete' as const,
      resolution: 'not_found' as const,
      reason: 'no_invitation',
    };
  }

  const evidence = {
    nodes: { previous: 'detectar_intencion', current: 'responder_invitacion' },
    history: { status: 'available', recent_messages: [] },
    user_message: 'Confirmo mi asistencia',
    decision: null,
    extraction: {
      action_intent: 'responder_invitacion',
      rsvp_action: 'confirm',
      ambiguity: { status: 'clear', clarification_question: null },
    },
    plan: {
      current_node: 'responder_invitacion',
      contact_phone_present: true,
      rsvp_state: { status: 'pending', pending_action: null, selection_attempts: 0 },
    },
    information_results: [],
    rsvp_phone_evidence: rsvpEvidence,
    turn_state: {
      focus_need_category: null,
      missing_fields: [],
      search_ready: false,
      missing_fields_instruction: 'No hay faltantes registrados.',
    },
    provider_candidates: [],
    recommendation_funnel: null,
  };

  return `Evidencia canónica del turno (JSON): ${JSON.stringify(evidence, null, 2)}`;
}

function sampleGenericReplyEvidence(route: string): unknown {
  return {
    nodes: { previous: 'detectar_intencion', current: route },
    history: { status: 'available', recent_messages: [] },
    user_message: 'Hola, quiero continuar con mi plan',
    decision: {
      route_kind: 'ask_event_context',
      presentation_scope: 'single_need',
      provider_search_mode: 'none',
      focus_need_category: null,
      needs_to_present: [],
      stop_reason: null,
    },
    extraction: {
      action_intent: null,
      ambiguity: { status: 'clear', clarification_question: null },
    },
    plan: {
      current_node: route,
      event_type: 'matrimonio',
      focus_need_category: null,
    },
    information_results: [],
    rsvp_phone_evidence: null,
    turn_state: {
      focus_need_category: null,
      missing_fields: [],
      search_ready: false,
      missing_fields_instruction: 'No hay faltantes registrados.',
    },
    provider_candidates: [],
    recommendation_funnel: null,
  };
}

function toolCountForNode(node: DecisionNode): number {
  return nodePromptManifest[node]?.allowedTools.length ?? 0;
}

function schemaPropertyCountForNode(node: DecisionNode): number {
  // Approximate schema property counts per node, aligned with openai-agent-runtime resolveOutputSchema
  // Use fixed representative counts to keep measurement deterministic and matching live metrics shape
  if (node === 'contacto_inicial') return 5;
  if (node === 'recomendar') return 8;
  if (node === 'crear_lead_cerrar') return 6;
  return 4;
}

function schemaPropertyCountForExtractor(profileName: string): number {
  // Count of properties in extraction schema for each profile, approximate
  const counts: Record<string, number> = {
    conversation_only: 8,
    rsvp: 11,
    initial_planning_information: 16,
    active_plan: 20,
    shortlist: 24,
  };
  return counts[profileName] ?? 8;
}

export async function measureCurrentBranches(args: {
  loader: PromptLoader;
  counterModel: string;
}): Promise<BranchMeasurement[]> {
  const measurements: BranchMeasurement[] = [];

  // Classifier branches
  for (const profile of ['general', 'campaign_reply'] as const) {
    const branchId = profile === 'general' ? 'classifier' : 'classifier:campaign_reply';
    const bundle = await args.loader.loadResponseClassifierBundle(profile);
    const input = sampleInputForBranch(branchId);
    const base = measureBundle({
      bundle,
      route: branchId,
      input,
      counterModel: args.counterModel,
      toolCount: 0,
      schemaPropertyCount: 8,
    });
    measurements.push({
      ...base,
      branchId,
      callType: 'classifier',
      component: 'classifier',
      description: `${base.description} | classifier profile ${profile}`,
    });
  }

  // Extractor branches
  for (const profile of extractorAuditProfiles) {
    const branchId = `extractor:${profile.name}`;
    const bundle = await args.loader.loadExtractorBundle(profile.capabilities);
    const input = sampleInputForBranch(branchId);
    const base = measureBundle({
      bundle,
      route: branchId,
      input,
      counterModel: args.counterModel,
      toolCount: 0,
      schemaPropertyCount: schemaPropertyCountForExtractor(profile.name),
    });
    measurements.push({
      ...base,
      branchId,
      callType: 'extraction',
      component: 'extraction',
      description: `${base.description} | extraction profile ${profile.name}`,
    });
  }

  // Reply branches per node, with RSVP split
  for (const node of decisionNodes) {
    if (node === 'responder_invitacion') {
      for (const rsvpState of ['resolved_single', 'needs_event_selection', 'unavailable'] as const) {
        const branchId = `responder_invitacion:${rsvpState}`;
        const bundle = await args.loader.loadNodeBundle(node);
        const input = sampleInputForBranch(branchId);
        const base = measureBundle({
          bundle,
          route: branchId,
          input,
          counterModel: args.counterModel,
          toolCount: toolCountForNode(node),
          schemaPropertyCount: schemaPropertyCountForNode(node),
        });
        measurements.push({
          ...base,
          branchId,
          callType: 'reply',
          component: 'reply',
          description: `${base.description} | reply node ${node} rsvp_state=${rsvpState}`,
        });
      }
    } else {
      const branchId = node;
      const bundle = await args.loader.loadNodeBundle(node);
      const input = sampleInputForBranch(branchId);
      const base = measureBundle({
        bundle,
        route: branchId,
        input,
        counterModel: args.counterModel,
        toolCount: toolCountForNode(node),
        schemaPropertyCount: schemaPropertyCountForNode(node),
      });
      measurements.push({
        ...base,
        branchId,
        callType: 'reply',
        component: 'reply',
        description: `${base.description} | reply node ${node}`,
      });
    }
  }

  return measurements.sort((a, b) => a.branchId.localeCompare(b.branchId));
}

export async function measureHistoricalBranches(args: {
  anchorRef: string;
  counterModel: string;
  historicalReader?: HistoricalReader;
}): Promise<BranchMeasurement[]> {
  const reader = args.historicalReader ?? readHistoricalPrompt;
  const measurements: BranchMeasurement[] = [];

  async function loadHistoricalBundle(
    relativePaths: readonly string[],
    allowedTools: readonly string[],
  ): Promise<PromptBundle> {
    const contents = new Map<string, string>();
    for (const relativePath of relativePaths) {
      const content = await reader(args.anchorRef, relativePath);
      contents.set(relativePath, content);
    }
    return buildBundleFromContents(relativePaths, contents, allowedTools);
  }

  // Classifier
  for (const profile of ['general', 'campaign_reply'] as const) {
    const branchId = profile === 'general' ? 'classifier' : 'classifier:campaign_reply';
    const relativePaths = responseClassifierPromptFiles[profile];
    const bundle = await loadHistoricalBundle(relativePaths, []);
    const input = sampleInputForBranch(branchId);
    const base = measureBundle({
      bundle,
      route: branchId,
      input,
      counterModel: args.counterModel,
      toolCount: 0,
      schemaPropertyCount: 8,
    });
    measurements.push({
      ...base,
      branchId,
      callType: 'classifier',
      component: 'classifier',
    });
  }

  // Extractors
  for (const profile of extractorAuditProfiles) {
    const branchId = `extractor:${profile.name}`;
    const relativePaths = extractorPromptFilesForCapabilities(profile.capabilities);
    const bundle = await loadHistoricalBundle(relativePaths, []);
    const input = sampleInputForBranch(branchId);
    const base = measureBundle({
      bundle,
      route: branchId,
      input,
      counterModel: args.counterModel,
      toolCount: 0,
      schemaPropertyCount: schemaPropertyCountForExtractor(profile.name),
    });
    measurements.push({
      ...base,
      branchId,
      callType: 'extraction',
      component: 'extraction',
    });
  }

  // Reply
  for (const node of decisionNodes) {
    const manifestFiles = nodePromptManifest[node].files;
    const sharedFiles = conversationPromptFilesForNode(node);
    const relativePaths = [...sharedFiles, ...manifestFiles];
    const bundle = await loadHistoricalBundle(relativePaths, nodePromptManifest[node].allowedTools);
    if (node === 'responder_invitacion') {
      for (const rsvpState of ['resolved_single', 'needs_event_selection', 'unavailable'] as const) {
        const branchId = `responder_invitacion:${rsvpState}`;
        const input = sampleInputForBranch(branchId);
        const base = measureBundle({
          bundle,
          route: branchId,
          input,
          counterModel: args.counterModel,
          toolCount: toolCountForNode(node),
          schemaPropertyCount: schemaPropertyCountForNode(node),
        });
        measurements.push({
          ...base,
          branchId,
          callType: 'reply',
          component: 'reply',
        });
      }
    } else {
      const branchId = node;
      const input = sampleInputForBranch(branchId);
      const base = measureBundle({
        bundle,
        route: branchId,
        input,
        counterModel: args.counterModel,
        toolCount: toolCountForNode(node),
        schemaPropertyCount: schemaPropertyCountForNode(node),
      });
      measurements.push({
        ...base,
        branchId,
        callType: 'reply',
        component: 'reply',
      });
    }
  }

  return measurements.sort((a, b) => a.branchId.localeCompare(b.branchId));
}

export function summarizeMeasurements(branches: readonly BranchMeasurement[]): BranchBaseline['summary'] {
  return {
    totalInstructionBytes: branches.reduce((sum, branch) => sum + branch.instructionBytes, 0),
    totalInputBytes: branches.reduce((sum, branch) => sum + branch.inputBytes, 0),
    totalSerializedRequestBytes: branches.reduce((sum, branch) => sum + branch.serializedRequestBytes, 0),
  };
}
