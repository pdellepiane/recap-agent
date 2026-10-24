import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditActualRequestContract, auditLoadedRequestInstructions } from '../src/audit/prompt-contracts';
import { createEmptyPlan, mergePlan, type PersistedPlan } from '../src/core/plan';
import { buildRuntimeCapabilityManifest } from '../src/runtime/capability-manifest';
import { requestedOperationSchema } from '../src/runtime/extraction-schemas';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';

function runtime(enabled: boolean, overrides: Parameters<typeof buildRuntimeCapabilityManifest>[0] = {}) {
  return new OpenAiAgentRuntime({
    apiKey: 'offline-contract', replyModel: 'offline', extractorModel: 'offline',
    replyProviderLimit: 4, presentationProviderLimit: 5, providerDetailLookupLimit: 3,
    promptLoader: new PromptLoader(path.resolve('prompts')),
    providerGateway: { async searchProviders(): Promise<never> { throw new Error('offline only'); } } as never,
    capabilityManifest: buildRuntimeCapabilityManifest({
      configured: true, environment: 'development', allowCustomerWrites: true,
      featureFlags: {
        faq: enabled, invitedEventLookup: enabled, purchaseInformation: enabled,
        rsvp: enabled, providerPlanning: enabled, providerSearch: enabled,
        providerQuoteRequests: enabled, ...overrides.featureFlags,
      },
    }),
  });
}
function plan(active: boolean): PersistedPlan {
  const base = createEmptyPlan({ planId: 'schema-contract', channel: 'whatsapp', externalUserId: '51900000991' });
  return mergePlan(base, active ? {
    provider_needs: [{ category: 'Catering', status: 'shortlisted', preferences: [], hard_constraints: [],
      missing_fields: [], selected_provider_ids: [], selected_provider_hints: [],
      recommended_providers: [], recommended_provider_ids: [] }],
  } : {}) as PersistedPlan;
}

async function spec(enabled: boolean, active: boolean, overrides: Parameters<typeof buildRuntimeCapabilityManifest>[0] = {}) {
  return runtime(enabled, overrides).buildExtractionRequestSpec({
    plan: plan(active), userMessage: 'Quiero retirar mis fondos',
    messageContext: localTurnMessageContext('not_configured'),
  });
}

describe('schema-bound actual extraction composition', () => {
  it.each([false, true])('selects field guidance from the exact output schema, enabled=%s', async (enabled) => {
    const request = await spec(enabled, true);
    const shape = request.outputSchema.shape;
    for (const [file, field] of [
      ['extractors/information.txt', 'informationRequests'],
      ['extractors/rsvp.txt', 'rsvpAction'],
      ['extractors/planning.txt', 'eventType'],
      ['extractors/provider_operations.txt', 'providerPlanOperations'],
      ['extractors/provider_selection.txt', 'selectedProviderReferences'],
      ['extractors/provider_inspection.txt', 'providerDetailRequest'],
      ['extractors/close_pause.txt', 'closeAction'],
      ['extractors/pause.txt', 'pauseRequested'],
    ] as const) {
      expect(request.filePaths.includes(file), file).toBe(field in shape);
    }
    expect(request.filePaths).not.toContain('shared/customer_context_fields.txt');
    expect(request.filePaths).not.toContain('extractors/customer_fields.txt');
    expect(request.instructions).not.toContain('destination_account');
  });

  it('keeps unsupported requested operations expressible without advertising executable tools', async () => {
    const request = await spec(false, false);
    expect(request.extractionProjection.allowedOperations).toEqual(requestedOperationSchema.options);
    expect(request.outputSchema.shape.requestedOperation?.safeParse('refund_or_withdrawal.execute').success).toBe(true);
    expect(request.input).toContain('refund_or_withdrawal.execute');
    expect(request.manifest.tools).toEqual([]);
    expect(request.instructions).not.toContain('Usa acciones disponibles');
    expect(request.input).not.toContain('No extraigas acciones fuera');
  });

  it('does not advertise retired pause or unavailable final-close rules', async () => {
    const request = await spec(true, true, { featureFlags: { providerQuoteRequests: false } });
    expect(request.outputSchema.shape).not.toHaveProperty('pauseRequested');
    expect(request.outputSchema.shape.actionIntent.safeParse('pausar').success).toBe(false);
    expect(request.outputSchema.shape).not.toHaveProperty('closeAction');
    expect(request.filePaths).not.toContain('extractors/pause.txt');
    expect(request.filePaths).not.toContain('extractors/close_pause.txt');
    expect(request.instructions).not.toContain('jamás');
  });

  it('validates mixed capability states through the actual production builder', async () => {
    const loader = new PromptLoader(path.resolve('prompts'));
    for (let mask = 0; mask < 32; mask += 1) {
      const flags = {
        faq: (mask & 1) !== 0, invitedEventLookup: false, purchaseInformation: false,
        rsvp: (mask & 2) !== 0, providerPlanning: (mask & 4) !== 0,
        providerSearch: (mask & 8) !== 0, providerQuoteRequests: (mask & 16) !== 0,
      };
      for (const active of [false, true]) {
        const request = {
          plan: plan(active), userMessage: 'Consulta de prueba',
          messageContext: localTurnMessageContext('not_configured'),
        };
        const built = await runtime(false, { featureFlags: flags }).buildExtractionRequestSpec(request);
        expect(auditActualRequestContract({ spec: built, context: built.compilerContext,
          evidence: request, outputSchema: built.outputSchema }), `${mask}/${active}`).toEqual([]);
        expect(await auditLoadedRequestInstructions(built, loader)).toEqual([]);
        for (const intent of built.extractionProjection.allowedActionIntents) {
          expect(built.outputSchema.shape.actionIntent.safeParse(intent).success).toBe(true);
        }
      }
    }
  });

});
