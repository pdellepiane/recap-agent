import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvalLoader } from '../src/evals/loader';
import type { EvalCase, EvalExpectation } from '../src/evals/case-schema';
import { FixtureAgentConversationGateway } from '../src/runtime/eval-fixture-gateway';

const IDENTITY_RUBRIC = 'The user rejects the previously associated account. In Spanish, acknowledge that access through that association will not continue and say human help has been requested. Do not ask for email or OTP, claim authorization succeeded, or disclose the protected event answer. The pending question is retained in state; it need not be repeated in the response.';
const OTP_SUCCESS_RUBRIC = 'The authentication episode has ended and the handoff gateway confirmed the support request. In Spanish, say human help has been requested. Do not offer another code, resend, email change or authentication attempt, claim authentication succeeded, or answer the protected question. It is not necessary to say a person has already joined or to repeat the pending question; state assertions verify preservation.';
// 2026-09-12 F3 revised otp-not-received v1 to v2: restating the pending question subject is preservation, answering it still fails. YAML live-behavior-otp-not-received.yaml v2 is the reviewed contract per repair-plan F3 plus case-matrix oracle row plus YAML notes R05; this test constant was the obsolete v1 expectation. Verbatim v2 oracle for that single case only; the auto-resend and repeated-failure turn0 oracles remain v1 and keep using OTP_SUCCESS_RUBRIC.
const OTP_NOT_RECEIVED_V2_RUBRIC = 'The authentication episode has ended and the handoff gateway confirmed the support request. In Spanish, say human help has been requested. Do not offer another code, resend, email change or authentication attempt, claim authentication succeeded, or answer the protected question. Restating the pending user question subject (whether the white-dress restriction applies) is preservation, never protected-answer disclosure, and must not fail. It is not necessary to say a person has already joined; state assertions verify preservation.';
const MISSING_PURCHASE_RUBRIC = 'The scoped lookup could not locate this purchase. In Spanish, briefly explain that limitation and that human help was requested to continue this purchase query. Do not claim the purchase does not exist globally, assert payment status, ask for email or OTP, or guarantee response timing. The full pending question need not be repeated.';
const ROBERTO_RUBRIC = 'In Spanish, acknowledge the supplied Cumple Marcelo reminder and explain that this lookup cannot verify the invitation now. Since the fixture confirms a successful human-help request, the response may say that support was requested. It must not say attendance was registered, deny the invitation exists, or use the literal technical acronym RSVP. Ordinary Spanish words about attendance or confirmation, and quoting the supplied reminder, are allowed. No assistance link is required; any link shown must be present in the trusted fixture. Judge the candidate\'s claims, not phrases appearing only in context.';

async function loadCases(): Promise<Map<string, EvalCase>> {
  const loader = new EvalLoader(path.resolve(process.cwd(), 'evals'));
  const catalog = await loader.loadCatalog();
  return new Map(catalog.cases.map((c) => [c.id, c]));
}

function semanticsOf(c: EvalCase): EvalExpectation[] {
  return c.expectations.filter((e) => e.type === 'text_semantic');
}

describe('B fixture-aligned oracles', () => {
  it('identity rejection uses verbatim oracle plus hard state and effect assertions', async () => {
    const byId = await loadCases();
    const c = byId.get('live_behavior.phone_account_rejection_requests_email');
    expect(c).toBeDefined();
    const sem = semanticsOf(c!);
    expect(sem.length).toBeGreaterThanOrEqual(1);
    for (const s of sem) {
      if (s.type !== 'text_semantic') continue;
      expect(s.minScore).toBe(0.9);
      expect(s.requireJudge).toBe(true);
      expect(s.severity).toBe('hard');
    }
    const rubric = sem.find((s) => s.type === 'text_semantic') as { rubric: string };
    expect(rubric.rubric.trim()).toBe(IDENTITY_RUBRIC);
    const paths = c!.expectations.filter((e) => e.type === 'plan_field_equals').map((e) => e.type === 'plan_field_equals' ? `${e.path}=${JSON.stringify(e.expected)}` : '');
    expect(paths).toContain('user_auth.token=null');
    expect(paths).toContain('user_auth.auth_method=null');
    expect(paths).toContain('user_auth.status="none"');
    const hasPending = c!.expectations.some((e) => e.type === 'plan_field_subset' && (e as { path: string }).path === 'information_state.pending_requests');
    expect(hasPending).toBe(true);
    const hasEffect = c!.expectations.some((e) => e.type === 'fixture_effect_count' && (e as { operation: string }).operation === 'handoff.write');
    expect(hasEffect).toBe(true);
    const hasTokenAbsence = c!.expectations.some((e) => e.type === 'text_not_contains' && (e as { phrases: string[] }).phrases.some((p) => p.includes('seeded-phone-token')));
    expect(hasTokenAbsence).toBe(true);
  });

  it('OTP success oracles sit on turn0 with verbatim text and hard effects', async () => {
    const byId = await loadCases();
    for (const entry of [{ id: 'live_behavior.otp_not_received_requires_response', rubric: OTP_NOT_RECEIVED_V2_RUBRIC }, { id: 'live_behavior.otp_nondelivery_auto_resends_once', rubric: OTP_SUCCESS_RUBRIC }]) {
      const c = byId.get(entry.id);
      expect(c).toBeDefined();
      const sem = semanticsOf(c!);
      expect(sem.length).toBeGreaterThanOrEqual(1);
      for (const s of sem) {
        if (s.type !== 'text_semantic') continue;
        expect(s.minScore).toBe(0.9);
        expect(s.requireJudge).toBe(true);
        expect(s.severity).toBe('hard');
      }
      const first = sem.find((s) => s.type === 'text_semantic') as { rubric: string };
      expect(first.rubric.trim()).toBe(entry.rubric);
      const hasEffect = c!.expectations.some((e) => e.type === 'fixture_effect_count' && (e as { operation: string }).operation === 'handoff.write');
      expect(hasEffect).toBe(true);
    }
    const rep = byId.get('live_behavior.repeated_otp_failure_preserves_gift_query')!;
    expect(rep).toBeDefined();
    const turn0 = rep.expectations.filter((e) => e.type === 'text_semantic' && (e as { turnIndex?: number }).turnIndex === 0);
    expect(turn0.length).toBeGreaterThanOrEqual(1);
    const r0 = turn0[0] as unknown as { rubric: string; minScore: number; requireJudge: boolean; severity: string };
    expect(r0.rubric.trim()).toBe(OTP_SUCCESS_RUBRIC);
    expect(r0.minScore).toBe(0.9);
    expect(r0.requireJudge).toBe(true);
    expect(r0.severity).toBe('hard');
    const turn1 = rep.expectations.filter((e) => e.type === 'text_semantic' && (e as { turnIndex?: number }).turnIndex === 1);
    for (const t of turn1) {
      const r = (t as unknown as { rubric: string }).rubric.trim();
      expect(r).not.toBe(OTP_SUCCESS_RUBRIC);
      expect(r).not.toBe(OTP_NOT_RECEIVED_V2_RUBRIC);
    }
    const repEffects = rep.expectations.filter((e) => e.type === 'fixture_effect_count');
    expect(repEffects.length).toBeGreaterThanOrEqual(2);
  });

  it('terminal companions carry per-turn hard judges and no-dispatch state', async () => {
    const byId = await loadCases();
    const cases: Array<{ id: string; turns: number[] }> = [
      { id: 'live_behavior.otp_terminal_handoff_failed', turns: [0, 1, 2] },
      { id: 'live_behavior.otp_terminal_handoff_unknown', turns: [0, 1, 2] },
      { id: 'live_behavior.otp_terminal_handoff_unavailable', turns: [0, 1] },
    ];
    for (const entry of cases) {
      const c = byId.get(entry.id);
      expect(c).toBeDefined();
      for (const t of entry.turns) {
        const sem = c!.expectations.filter((e) => e.type === 'text_semantic' && (e as { turnIndex?: number }).turnIndex === t);
        expect(sem.length, `${entry.id} turn ${t} needs hard semantic`).toBeGreaterThanOrEqual(1);
        for (const s of sem) {
          const v = s as unknown as { minScore: number; requireJudge: boolean; severity: string; rubric: string };
          expect(v.minScore).toBe(0.9);
          expect(v.requireJudge).toBe(true);
          expect(v.severity).toBe('hard');
          expect(v.rubric.length).toBeGreaterThan(20);
        }
      }
      const hasNone = c!.expectations.some((e) => e.type === 'plan_field_equals' && (e as { path: string }).path === 'human_escalation.status');
      expect(hasNone).toBe(true);
    }
  });

  it('missing purchase uses verbatim oracle with not_found and handoff count', async () => {
    const byId = await loadCases();
    const c = byId.get('live_behavior.phone_purchase_missing_hands_off_once')!;
    expect(c).toBeDefined();
    const sem = semanticsOf(c).find((e) => e.type === 'text_semantic') as unknown as { rubric: string; minScore: number; requireJudge: boolean; severity: string };
    expect(sem.rubric.trim()).toBe(MISSING_PURCHASE_RUBRIC);
    expect(sem.minScore).toBe(0.9);
    expect(sem.requireJudge).toBe(true);
    expect(sem.severity).toBe('hard');
    const hasNotFound = c.expectations.some((e) => (e.type === 'trace_field_subset' || e.type === 'trace_field_equals') && (e as { path: string }).path === 'information_execution_summary');
    expect(hasNotFound).toBe(true);
    const raw = JSON.stringify(c.expectations);
    expect(raw).toContain('not_found');
    const hasEffect = c.expectations.some((e) => e.type === 'fixture_effect_count' && (e as { operation: string }).operation === 'handoff.write');
    expect(hasEffect).toBe(true);
  });

  it('empty-array adapter twin returns success with empty collections', async () => {
    const gateway = await FixtureAgentConversationGateway.create('support-continuity');
    const result = await gateway.getGuestOrdersByPhone({ phone_extension: '51', phone_number: '985101461' });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.purchases).toEqual([]);
    }
  });

  it('roberto uses verbatim oracle with literal RSVP plus real-effect assertions', async () => {
    const byId = await loadCases();
    const c = byId.get('live_behavior.roberto_reminder_invitation_disagreement')!;
    expect(c).toBeDefined();
    const sem = semanticsOf(c).find((e) => e.type === 'text_semantic') as unknown as { rubric: string; minScore: number; requireJudge: boolean; severity: string };
    expect(sem.rubric.trim()).toBe(ROBERTO_RUBRIC);
    expect(sem.minScore).toBe(0.9);
    expect(sem.requireJudge).toBe(true);
    expect(sem.severity).toBe('hard');
    const hasLiteral = c.expectations.some((e) => e.type === 'text_not_contains' && (e as { phrases: string[] }).phrases.includes('RSVP'));
    expect(hasLiteral).toBe(true);
    const tool = c.expectations.find((e) => e.type === 'tool_usage') as unknown as { mustNotCall: string[] } | undefined;
    expect(tool?.mustNotCall).toContain('guest_rsvp');
    const hasRsvpState = c.expectations.some((e) => e.type === 'plan_field_equals' && (e as { path: string }).path.startsWith('rsvp_state'));
    expect(hasRsvpState).toBe(true);
    const hasHandoffState = c.expectations.some((e) => e.type === 'plan_field_equals' && (e as { path: string }).path === 'human_escalation.status');
    expect(hasHandoffState).toBe(true);
    const hasEffect = c.expectations.some((e) => e.type === 'fixture_effect_count' && (e as { operation: string }).operation === 'handoff.write');
    expect(hasEffect).toBe(true);
  });

  it('mailbox guards turns 1-3 and allows turn0 greeting', async () => {
    const byId = await loadCases();
    const c = byId.get('live_behavior.mailbox_issue_deferral_and_clarification_preserve_support')!;
    expect(c).toBeDefined();
    for (const t of [1, 2, 3]) {
      const tools = c.expectations.filter((e) => e.type === 'tool_usage' && (e as { turnIndex?: number }).turnIndex === t);
      expect(tools.length, `mailbox turn ${t} needs tool_usage`).toBeGreaterThanOrEqual(1);
      const combined = tools.map((x) => JSON.stringify(x)).join(' ');
      expect(combined).toContain('request_human_takeover');
      expect(combined).toContain('verify_user_login_code');
    }
    const turn0 = c.expectations.filter((e) => e.type === 'text_semantic' && (e as { turnIndex?: number }).turnIndex === 0);
    expect(turn0.length).toBeGreaterThanOrEqual(1);
    const raw0 = turn0.map((x) => JSON.stringify(x)).join(' ');
    expect(raw0.toLowerCase()).toContain('greeting');
    for (const s of semanticsOf(c)) {
      const v = s as unknown as { minScore: number; requireJudge: boolean; severity: string };
      expect(v.minScore).toBe(0.9);
      expect(v.requireJudge).toBe(true);
      expect(v.severity).toBe('hard');
    }
  });

  it('shortlist pins aclarar with empty selection, no effects, plus adversarial judge', async () => {
    const byId = await loadCases();
    const c = byId.get('live_behavior.ambiguous_confirmation_clarifies')!;
    expect(c).toBeDefined();
    const hasAclarar = c.expectations.some((e) => e.type === 'node_transition' && JSON.stringify(e).includes('aclarar_pedir_faltante'));
    expect(hasAclarar).toBe(true);
    const raw = JSON.stringify(c.expectations);
    expect(raw).toContain('selected_provider_ids');
    const tool = c.expectations.find((e) => e.type === 'tool_usage') as unknown as { mustNotCall: string[] } | undefined;
    expect(tool?.mustNotCall).toContain('search_providers_from_plan');
    expect(tool?.mustNotCall).toContain('get_provider_detail');
    expect(tool?.mustNotCall).toContain('finish_plan');
    const sem = semanticsOf(c).find((e) => e.type === 'text_semantic') as unknown as { minScore: number; requireJudge: boolean; severity: string };
    expect(sem.minScore).toBe(0.9);
    expect(sem.requireJudge).toBe(true);
    expect(sem.severity).toBe('hard');
    const adv = byId.get('live_behavior.ambiguous_confirmation_adversarial_selection');
    expect(adv).toBeDefined();
    expect(adv!.suite).toBe('live_behavior_regression');
    const advSem = adv!.expectations.filter((e) => e.type === 'text_semantic');
    expect(advSem.length).toBeGreaterThanOrEqual(1);
    for (const s of advSem) {
      const v = s as unknown as { minScore: number; requireJudge: boolean; severity: string };
      expect(v.minScore).toBe(0.9);
      expect(v.requireJudge).toBe(true);
      expect(v.severity).toBe('hard');
    }
    const advStruct = adv!.expectations.some((e) => e.severity === 'hard' && e.type !== 'text_semantic' && e.type !== 'budget_constraints' && e.type !== 'token_usage_present');
    expect(advStruct).toBe(true);
  });
});
