import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import type { PersistedPlan } from '../src/core/plan';
import { createEmptyPlan } from '../src/core/plan';

describe('offline twins provenance fixes F2 F3', () => {
  it('operational note cart clause contains no-email-channel instruction and no channel beyond en esta conversacion', () => {
    const agentServicePath = path.resolve(process.cwd(), 'src/runtime/agent-service.ts');
    const content = fs.readFileSync(agentServicePath, 'utf8');
    // must contain the pinned channel wording
    expect(content).toContain('en esta conversacion; no afirmes que se envio por correo ni menciones otro canal de envio, sin inventar ni repetir la URL');
    // must not contain old wording without channel pin
    expect(content).toContain('enlace de recuperacion ya enviado en esta conversacion');
    // response contract counterpart
    const contractPath = path.resolve(process.cwd(), 'prompts/nodes/resolver_consultas_informativas/response_contract.txt');
    const contract = fs.readFileSync(contractPath, 'utf8');
    expect(contract).toContain('Para un carrito abandonado sin órdenes, usa solo su estado, evento y la ruta de recuperación autorizada por la evidencia.');
    expect(contract).not.toContain('y enlace ya enviado, sin URL/montos.');
    // ensure operational note does not assert email channel elsewhere for cart clause
    // the only correo mention in cart clause should be the negation, not an affirmation
    const cartClauseMatches = content.match(/enlace de recuperacion ya enviado.*?(?:\n|$)/gu) ?? [];
    for (const clause of cartClauseMatches) {
      // each cart clause must include the negation, not a positive email claim
      if (clause.includes('recuperacion ya enviado')) {
        expect(clause).toContain('no afirmes que se envio por correo');
      }
    }
  });

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
