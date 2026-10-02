import { describe, expect, it } from 'vitest';

import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import type { PersistedPlan } from '../src/core/plan';
import { createEmptyPlan } from '../src/core/plan';

describe('offline twins provenance fixes F2 F3', () => {
  it('phone-resolved resolver snapshots contain no null email keys', () => {
    const runtime = new OpenAiAgentRuntime({
      apiKey: 'test',
      replyModel: 'gpt-5.6-luna',
      extractorModel: 'gpt-5.6-luna',
      replyProviderLimit: 5,
      presentationProviderLimit: 5,
      providerDetailLookupLimit: 5,
      promptLoader: {
        loadExtractorBundle: async () => ({ id: 'test', instructions: 'test', filePaths: [] }),
        loadNodeBundle: async () => ({ id: 'test', instructions: 'test', filePaths: [] }),
      } as never,
      providerGateway: {} as never,
    });
    const buildExtraction = (runtime as unknown as { buildReplyExtractionSnapshot: (e: unknown, n: string) => Record<string, unknown> }).buildReplyExtractionSnapshot.bind(runtime);
    const buildPlan = (runtime as unknown as { buildPromptPlanSnapshot: (p: PersistedPlan, f: unknown, n: string) => Record<string, unknown> }).buildPromptPlanSnapshot.bind(runtime);

    const extractionSnapshot = buildExtraction(
      {
        actionIntent: 'consultar_compra',
        informationRequests: [],
        phoneConfirmation: null,
        contactEmail: null,
        ambiguity: null,
      },
      'resolver_consultas_informativas',
    );
    expect(extractionSnapshot).not.toHaveProperty('contact_email');
    expect(JSON.stringify(extractionSnapshot)).not.toContain('contact_email');
    expect(JSON.stringify(extractionSnapshot)).not.toContain('correo');

    // non-null should be present
    const extractionSnapshotWithEmail = buildExtraction(
      {
        actionIntent: 'consultar_compra',
        informationRequests: [],
        phoneConfirmation: null,
        contactEmail: 'test@example.com',
        ambiguity: null,
      },
      'resolver_consultas_informativas',
    );
    expect(extractionSnapshotWithEmail).toHaveProperty('contact_email', 'test@example.com');

    const basePlan = createEmptyPlan({ planId: 'test-plan', channel: 'whatsapp', externalUserId: 'test-user' });
    // ensure null email state
    const phoneResolvedPlan: PersistedPlan = {
      ...basePlan,
      contact_email: null,
      user_auth: {
        ...basePlan.user_auth,
        status: 'none',
        email: null,
        token: null,
        token_expires_at: null,
        failed_code_attempts: 0,
      },
    };
    const planSnapshot = buildPlan(phoneResolvedPlan, null, 'resolver_consultas_informativas');
    expect(planSnapshot).not.toHaveProperty('contact_email');
    const infoState = planSnapshot.information_state as Record<string, unknown> | undefined;
    expect(infoState).toBeDefined();
    expect(infoState).not.toHaveProperty('authenticated_email');
    // failed_code_attempts should be present when 0 (not null) - but test null omission
    const planWithNullFailed: PersistedPlan = {
      ...basePlan,
      contact_email: null,
      user_auth: {
        ...basePlan.user_auth,
        status: 'none',
        email: null,
        token: null,
        token_expires_at: null,
        failed_code_attempts: null as unknown as number,
      },
    };
    const planSnapshotNullFailed = buildPlan(planWithNullFailed, null, 'resolver_consultas_informativas');
    const infoStateNull = planSnapshotNullFailed.information_state as Record<string, unknown>;
    expect(infoStateNull).not.toHaveProperty('authenticated_email');
    expect(infoStateNull).not.toHaveProperty('failed_code_attempts');
    expect(planSnapshotNullFailed).not.toHaveProperty('contact_email');

    // non-null email should be preserved
    const planWithEmail: PersistedPlan = {
      ...basePlan,
      contact_email: 'user@example.com',
      user_auth: {
        ...basePlan.user_auth,
        status: 'authenticated',
        email: 'user@example.com',
        token: 'tok',
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        failed_code_attempts: 1,
      },
    };
    const planSnapshotWithEmail = buildPlan(planWithEmail, null, 'resolver_consultas_informativas');
    expect(planSnapshotWithEmail).toHaveProperty('contact_email', 'user@example.com');
    const infoWithEmail = planSnapshotWithEmail.information_state as Record<string, unknown>;
    expect(infoWithEmail).toHaveProperty('authenticated_email', 'user@example.com');
    expect(infoWithEmail).toHaveProperty('failed_code_attempts', 1);
  });
});
