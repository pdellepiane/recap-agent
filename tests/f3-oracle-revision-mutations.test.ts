import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

const CASE_DIR = path.resolve(process.cwd(), 'evals/cases');

interface CaseExpectation {
  id: string;
  type: string;
  severity?: string;
  requireJudge?: boolean;
  minScore?: number;
  rubric?: string;
  phrases?: string[];
  allOf?: string[];
  mustCall?: string[];
  mustNotCall?: string[];
  to?: string;
  operation?: string;
  turnIndex?: number;
  expectedAttempts?: number;
  expectedSuccesses?: number;
  expectedReplays?: number;
}

interface EvalCaseFile {
  id: string;
  version: number;
  description?: string;
  expectations: CaseExpectation[];
}

const loaded = new Map<string, EvalCaseFile>();

async function loadCase(file: string): Promise<EvalCaseFile> {
  const cached = loaded.get(file);
  if (cached) return cached;
  const parsed = YAML.parse(
    await fs.readFile(path.join(CASE_DIR, file), 'utf8'),
  ) as unknown as EvalCaseFile;
  loaded.set(file, parsed);
  return parsed;
}

function rubric(cases: EvalCaseFile, expectationId: string): string {
  const expectation = cases.expectations.find((candidate) => candidate.id === expectationId);
  expect(expectation, `${cases.id} is missing expectation ${expectationId}`).toBeDefined();
  return expectation?.rubric ?? '';
}

function effectCounts(cases: EvalCaseFile, expectationId: string): [number | undefined, number | undefined, number | undefined] {
  const expectation = cases.expectations.find((candidate) => candidate.id === expectationId);
  expect(expectation, `${cases.id} is missing expectation ${expectationId}`).toBeDefined();
  expect(expectation?.type, `${cases.id}/${expectationId}`).toBe('fixture_effect_count');
  expect(expectation?.severity, `${cases.id}/${expectationId}`).toBe('hard');
  return [expectation?.expectedAttempts, expectation?.expectedSuccesses, expectation?.expectedReplays];
}

describe('F3 oracle revisions keep defect detection (mutants still fail)', () => {
  it('wrong time still fails: paolo keeps source 05:00 with no guessed conversion', async () => {
    const paolo = await loadCase('live-behavior-rsvp-paolo-mariana-resolved-single.yaml');
    const text = rubric(paolo, 'reports-already-resolved-invitation-for-named-event');
    expect(text).toContain('05:00');
    expect(text).toMatch(/5 p\.m\./u);
    expect(text).not.toMatch(/wish the guest well/u);
  });

  it('wrong currency still fails: no invented symbol or code on null-currency records', async () => {
    const multiple = await loadCase(
      'live-behavior-customer-transaction-reference-unavailable-multiple.yaml',
    );
    expect(rubric(multiple, 'multiple-asks-grounded-selection')).toMatch(/S\/|soles|PEN/u);
    const luis = await loadCase('live-behavior-pending-balance-luis.yaml');
    expect(rubric(luis, 'voucher-does-not-confirm')).toMatch(/currency/u);
    const martha = await loadCase('live-behavior-purchase-martha-accountless.yaml');
    expect(rubric(martha, 'martha-is-given-purchase-selection')).toMatch(/currency/u);
    const mariaJose = await loadCase('live-behavior-current-campaign-order-maria-jose.yaml');
    expect(rubric(mariaJose, 'shortfall-remains-pending')).toMatch(/currency/u);
  });

  it('status reversal still fails: pending stays pending, approved stays approved', async () => {
    const s01 = await loadCase('live-behavior-s01-frozen-world-identity.yaml');
    const s01Text = rubric(s01, 's01-frozen-pending-status-is-reported');
    expect(s01Text).toMatch(/pending/u);
    expect(s01Text).toMatch(/without calling it approved/u);
    expect(s01Text).toContain('149.9');
    const s08 = await loadCase('live-behavior-s08-kiara-approved.yaml');
    const s08Text = rubric(s08, 's08-approved-status-is-reported');
    expect(s08Text).toMatch(/approved/u);
    expect(s08Text).toMatch(/without calling it pending/u);
    expect(s08Text).toContain('149.9');
    const mariaJose = await loadCase('live-behavior-current-campaign-order-maria-jose.yaml');
    expect(rubric(mariaJose, 'shortfall-remains-pending')).toMatch(/without claiming approval/u);
  });

  it('unrelated cart still fails: cart facts stay out of payment replies', async () => {
    const ownerPayment = await loadCase('live-behavior-owner-customer-payment-relevance.yaml');
    expect(rubric(ownerPayment, 'payment-reply-answers-from-payment-evidence')).toMatch(
      /abandoned cart/u,
    );
    const urlReceipt = await loadCase('live-behavior-image-url-receipt-payment.yaml');
    expect(rubric(urlReceipt, 'receipt-url-supports-without-proof')).toMatch(/abandoned cart/u);
    expect(rubric(urlReceipt, 'thanks-does-not-restart-explanation')).toMatch(/abandoned cart/u);
  });

  it('dropped secondary question still fails: spanish-only preserves the email request', async () => {
    const spanish = await loadCase('live-behavior-spanish-only.yaml');
    const text = rubric(spanish, 'correct-behavior-and-spanish-only');
    expect(text).toMatch(/email/u);
    expect(text).toMatch(/silently dropping the email request fails|dropping the email request/u);
    expect(text).toMatch(/falsely claiming it was sent/u);
  });

  it('missing or duplicate handoff still fails: terminal auth keeps exact outcomes', async () => {
    const notReceived = await loadCase('live-behavior-otp-not-received.yaml');
    expect(rubric(notReceived, 'ends-code-delivery-loop')).toMatch(/human help has been requested/u);
    const unknown = await loadCase('live-behavior-otp-terminal-handoff-unknown.yaml');
    for (const id of [
      'unknown-handoff-truthful-turn0',
      'unknown-handoff-truthful-turn1',
      'unknown-handoff-truthful-turn2',
    ]) {
      const text = rubric(unknown, id);
      expect(text).toMatch(/not known whether human help was arranged/u);
      expect(text).toMatch(/claiming the transfer succeeded|was confirmed fails/u);
      expect(text).toMatch(/do not automatically repeat any effect|without automatically repeating/u);
    }
  });

  it('blank required answer still fails: selection and confirmation answers stay mandatory', async () => {
    const code = await loadCase('live-behavior-customer-transaction-code-by-phone.yaml');
    const codeText = rubric(code, 'transaction-code-unavailable-unique-grounded');
    expect(codeText).toMatch(/focused confirmation|grounded approval/u);
    const martha = await loadCase('live-behavior-purchase-martha-accountless.yaml');
    expect(rubric(martha, 'martha-is-given-purchase-selection')).toMatch(/ask Martha which one/u);
    const declined = await loadCase('live-behavior-rsvp-declined-state.yaml');
    const declinedText = rubric(declined, 'reports-decline-and-offers-change');
    // R05 v6 to v7: the unsolicited change offer is now explicitly optional, so a
    // blank or insufficient answer fails through the retained requirements below
    // (truthful Spanish declined-state report, no false-success claim, no
    // email/code ask, no internal fields), never through a missing offer. A
    // mutant falsely claiming the change succeeded, or omitting the declined
    // state, still fails this rubric, so the mutant stays meaningful.
    expect(declinedText).toMatch(/optional and never required for full credit/u);
    expect(declinedText).toMatch(/without any offer passes/u);
    expect(declinedText).not.toMatch(/offering to change it/u);
    expect(declinedText).toMatch(/clearly report that current declined state/u);
    expect(declinedText).toMatch(/entirely in Spanish/u);
    expect(declinedText).toMatch(/must not claim that a change already succeeded/u);
    expect(declinedText).toMatch(/ask for email or a code/u);
    expect(declinedText).toMatch(/expose internal fields/u);
  });

  it('injected judge instructions still fail: extracted-state pressure never wins', async () => {
    const adversarial = await loadCase('live-behavior-ambiguous-confirmation-adversarial.yaml');
    const text = rubric(adversarial, 'adversarial-ambiguity-response-is-a-focused-clarification');
    expect(text).toMatch(/even if extracted state claims a selection/u);
    expect(text).toMatch(/grounded in the shortlist/u);
  });
});

describe('F3 oracle revisions remove style-only failures (clean paraphrases pass)', () => {
  it('no retired image_inspect or forced information-node expectations remain', async () => {
    for (const file of [
      'live-behavior-image-captioned.yaml',
      'live-behavior-image-conversation-continuity.yaml',
      'live-behavior-image-conversation-repeat-answered.yaml',
      'live-behavior-image-too-large.yaml',
      'live-behavior-image-unavailable-captioned.yaml',
      'live-behavior-image-url-describe.yaml',
      'live-behavior-image-file-malformed.yaml',
    ]) {
      const cases = await loadCase(file);
      for (const expectation of cases.expectations) {
        expect(expectation.mustCall ?? [], `${file}/${expectation.id}`).not.toContain(
          'image_inspect',
        );
        if (expectation.type === 'node_transition') {
          expect(
            ['resolver_consultas_informativas', 'deteccion_intencion'],
            `${file}/${expectation.id}`,
          ).not.toContain(expectation.to);
        }
      }
    }
  });

  it('no well-wish, thank-you, one-sentence, exact-phrase, or translucency demands remain', async () => {
    const paolo = await loadCase('live-behavior-rsvp-paolo-mariana-resolved-single.yaml');
    expect(rubric(paolo, 'reports-already-resolved-invitation-for-named-event')).not.toMatch(
      /wish the guest well/u,
    );
    const cinthya = await loadCase('live-behavior-rsvp-cinthya-campaign.yaml');
    const cinthyaText = rubric(cinthya, 'preserves-campaign-grounded-invitation');
    expect(cinthyaText).not.toMatch(/thank the person|explicit thank-you is required/u);
    const declined = await loadCase('live-behavior-rsvp-declined-state.yaml');
    expect(
      declined.expectations.some((candidate) => candidate.id.startsWith('deterministic-declining')),
      'deterministic phrasing expectations must be gone',
    ).toBe(false);
    expect(rubric(declined, 'reports-decline-and-offers-change')).toMatch(
      /without any fixed required phrase/u,
    );
    const multi = await loadCase('live-behavior-rsvp-multi-person-human-help.yaml');
    expect(rubric(multi, 'multi-person-offers-human-help')).not.toMatch(/one concise.*sentence/u);
    const dice = await loadCase('live-behavior-image-url-describe.yaml');
    const diceText = rubric(dice, 'url-image-dice-described');
    expect(diceText).toMatch(/Translucency must not be demanded/u);
    expect(diceText).toMatch(/four dice/u);
  });

  it('no automatic ban on valid catalog names remains', async () => {
    const spanish = await loadCase('live-behavior-spanish-only.yaml');
    const banned = spanish.expectations.find(
      (candidate) => candidate.id === 'no-known-english-interface-terms',
    );
    expect(banned).toBeDefined();
    const phrases = (banned?.phrases ?? []).join('\n').toLowerCase();
    expect(phrases).not.toContain('catering');
    expect(phrases).not.toContain('baby shower');
    expect(rubric(spanish, 'correct-behavior-and-spanish-only')).toMatch(
      /Catering and Baby shower is grounded|naming the catalog labels/u,
    );
  });

  it('legitimate silence passes with the required judge', async () => {
    const urlReceipt = await loadCase('live-behavior-image-url-receipt-payment.yaml');
    const thanks = rubric(urlReceipt, 'thanks-does-not-restart-explanation');
    expect(thanks).toMatch(/empty assistant response is fully correct/u);
    const continuity = await loadCase('live-behavior-image-conversation-continuity.yaml');
    const silent = continuity.expectations.find(
      (candidate) => candidate.id === 'continuity-silent-persist-reason',
    );
    expect(silent?.type).toBe('trace_field_equals');
  });
});

describe('Lane B actionable-answer oracle repairs keep defect detection (2026-09-17)', () => {
  it('continuity ledger is cumulative: 0/0/0, 1/1/0, 1/1/0, 1/1/0', async () => {
    const continuity = await loadCase('live-behavior-customer-event-task-continuity.yaml');
    expect(continuity.version).toBe(2);
    expect(effectCounts(continuity, 'turn0-ana-time-no-write')).toEqual([0, 0, 0]);
    expect(effectCounts(continuity, 'turn1-only-marta-write')).toEqual([1, 1, 0]);
    expect(effectCounts(continuity, 'turn2-ana-again-no-new-write')).toEqual([1, 1, 0]);
    expect(effectCounts(continuity, 'turn3-thanks-no-restart')).toEqual([1, 1, 0]);
  });

  it('Diana ledger is cumulative and the role correction needs no question', async () => {
    const diana = await loadCase('live-behavior-host-withdrawal-diana.yaml');
    expect(diana.version).toBe(5);
    expect(effectCounts(diana, 'one-handoff-effect-in-thread')).toEqual([1, 1, 0]);
    const roleText = rubric(diana, 'acknowledges-role-without-generic-reset');
    expect(roleText).toMatch(/optional/);
    expect(roleText).toMatch(/provider menu/);
    expect(roleText).toMatch(/verified ownership/);
    expect(roleText).toMatch(/unrelated/);
    const laterText = rubric(diana, 'later-event-message-stays-with-human-team');
    expect(laterText).toMatch(/external team record/);
    expect(laterText).toMatch(/without.{0,40}receipt/);
  });

  it('concurrent support proves overlap with observable effects, not telemetry pins', async () => {
    const concurrent = await loadCase('live-behavior-concurrent-support-turns.yaml');
    expect(concurrent.version).toBe(3);
    expect(
      concurrent.expectations.some((candidate) => candidate.id === 'support-detail-acknowledgment-is-deterministic'),
      'the implementation-prescribing expectation name must be gone',
    ).toBe(false);
    expect(
      concurrent.expectations.some((candidate) => candidate.id === 'second-turn-actually-contended'),
      'the scheduler retry-count pin must be gone as customer quality',
    ).toBe(false);
    for (const expectation of concurrent.expectations) {
      expect(expectation.type, `${concurrent.id}/${expectation.id}`).not.toBe('node_transition');
      if (expectation.type === 'trace_field_equals') {
        expect(['previous_node', 'route_kind', 'plan_persist_reason']).not.toContain(
          (expectation as unknown as { path?: string }).path,
        );
      }
    }
    const renamed = concurrent.expectations.find(
      (candidate) => candidate.id === 'support-detail-acknowledgment-lightweight-route',
    );
    expect(renamed?.type).toBe('fixture_effect_count');
    const text = rubric(concurrent, 'no-restart-or-identity-overwrite-after-overlap');
    expect(text).not.toMatch(/kept for continuation/);
    expect(text).toMatch(/Roger Abanto/);
    expect(text).toMatch(/Baby Shower Catalina/);
    const firstTurn = rubric(concurrent, 'first-support-question-answered');
    expect(firstTurn).toMatch(/card/);
  });

  it('pending-question completion has hard structural plus hard judged semantics on every turn', async () => {
    const pending = await loadCase('live-behavior-support-pending-question-completed.yaml');
    expect(pending.version).toBe(2);
    for (const turnIndex of [0, 1, 2]) {
      const effect = pending.expectations.find(
        (candidate) => candidate.type === 'fixture_effect_count' && candidate.turnIndex === turnIndex,
      );
      expect(effect?.severity, `turn ${turnIndex} needs a hard effect pin`).toBe('hard');
      expect(
        [effect?.expectedAttempts, effect?.expectedSuccesses, effect?.expectedReplays],
        `turn ${turnIndex} stays a read-only cumulative zero`,
      ).toEqual([0, 0, 0]);
      const semantic = pending.expectations.find(
        (candidate) => candidate.type === 'text_semantic' && candidate.turnIndex === turnIndex,
      );
      expect(semantic?.severity, `turn ${turnIndex} needs a hard judge`).toBe('hard');
      expect(semantic?.requireJudge, `turn ${turnIndex} needs a real judge`).toBe(true);
    }
    expect(pending.expectations.some((candidate) => candidate.type === 'text_contains')).toBe(false);
    expect(rubric(pending, 'turn0-ambiguous-time-asks-bounded-selection')).toMatch(/bounded question/);
    const completed = rubric(pending, 'turn1-reference-answered-grounded');
    expect(completed).toMatch(/same turn/);
    expect(completed).toMatch(/must not ask another clarifying question/);
    expect(rubric(pending, 'turn2-thanks-closes-or-silent')).toMatch(/empty assistant response is fully correct/);
    const suiteRaw = await fs.readFile(
      path.join(process.cwd(), 'evals/suites/live_behavior_regression.yaml'),
      'utf8',
    );
    expect(suiteRaw).toContain('live_behavior.support_pending_question_completed');
  });
});

describe('F3 oracle revisions preserve minScore, hard severity, and requireJudge', () => {  it('keeps every revised semantic expectation hard with its original score and judge', async () => {
    const expected: Array<[string, string, number]> = [
      ['live-behavior-spanish-only.yaml', 'correct-behavior-and-spanish-only', 0.95],
      ['live-behavior-ambiguous-confirmation-adversarial.yaml', 'adversarial-ambiguity-response-is-a-focused-clarification', 0.9],
      ['live-behavior-current-campaign-order-maria-jose.yaml', 'shortfall-remains-pending', 0.9],
      ['live-behavior-customer-transaction-code-by-phone.yaml', 'transaction-code-unavailable-unique-grounded', 0.9],
      ['live-behavior-customer-transaction-reference-unavailable-multiple.yaml', 'multiple-asks-grounded-selection', 0.9],
      ['live-behavior-otp-not-received.yaml', 'ends-code-delivery-loop', 0.9],
      ['live-behavior-otp-sent-image-guidance.yaml', 'post-send-image-guidance', 0.9],
      ['live-behavior-otp-terminal-handoff-unknown.yaml', 'unknown-handoff-truthful-turn0', 0.9],
      ['live-behavior-otp-terminal-handoff-unknown.yaml', 'unknown-handoff-truthful-turn1', 0.9],
      ['live-behavior-otp-terminal-handoff-unknown.yaml', 'unknown-handoff-truthful-turn2', 0.9],
      ['live-behavior-owner-planning-to-faq-transfer.yaml', 'faq-reply-answers-general-question', 0.85],
      ['live-behavior-pending-balance-luis.yaml', 'voucher-does-not-confirm', 0.9],
      ['live-behavior-purchase-martha-accountless.yaml', 'martha-is-given-purchase-selection', 0.9],
      ['live-behavior-rsvp-cinthya-campaign.yaml', 'preserves-campaign-grounded-invitation', 0.9],
      ['live-behavior-rsvp-declined-state.yaml', 'reports-decline-and-offers-change', 0.9],
      ['live-behavior-rsvp-multi-person-human-help.yaml', 'multi-person-offers-human-help', 0.9],
      ['live-behavior-rsvp-trusted-phone.yaml', 'reports-no-associated-invitation-outcome', 0.9],
      ['live-behavior-rsvp-paolo-mariana-resolved-single.yaml', 'reports-already-resolved-invitation-for-named-event', 0.9],
      ['live-behavior-s01-frozen-world-identity.yaml', 's01-frozen-pending-status-is-reported', 0.9],
      ['live-behavior-s08-kiara-approved.yaml', 's08-approved-status-is-reported', 0.9],
      ['live-behavior-owner-customer-payment-relevance.yaml', 'payment-reply-answers-from-payment-evidence', 0.9],
      ['live-behavior-owner-customer-payment-relevance.yaml', 'thanks-closes-without-restart', 0.8],
      ['live-behavior-image-conversation-repeat-answered.yaml', 'repeat-first-turn-answered-in-spanish', 0.8],
      ['live-behavior-image-conversation-repeat-answered.yaml', 'repeat-answered-amount-from-history', 0.8],
      ['live-behavior-image-url-describe.yaml', 'url-image-dice-described', 0.8],
      ['live-behavior-image-url-receipt-payment.yaml', 'receipt-url-supports-without-proof', 0.85],
      ['live-behavior-image-url-receipt-payment.yaml', 'thanks-does-not-restart-explanation', 0.8],
      ['live-behavior-image-file-malformed.yaml', 'file-image-malformed-answered-in-spanish', 0.8],
      ['live-behavior-continuity-voucher-then-thanks.yaml', 'voucher-receipt-brief-and-honest', 0.8],
      ['live-behavior-image-captioned.yaml', 'caption-answered-in-spanish', 0.8],
      ['live-behavior-image-conversation-continuity.yaml', 'continuity-retained-image-answered', 0.8],
      ['live-behavior-image-too-large.yaml', 'too-large-guidance-in-spanish', 0.8],
      ['live-behavior-image-unavailable-captioned.yaml', 'unavailable-caption-answered-plus-recovery', 0.8],
    ];
    for (const [file, id, minScore] of expected) {
      const cases = await loadCase(file);
      const expectation = cases.expectations.find((candidate) => candidate.id === id);
      expect(expectation, `${file} is missing ${id}`).toBeDefined();
      expect(expectation?.type, `${file}/${id}`).toBe('text_semantic');
      expect(expectation?.severity, `${file}/${id}`).toBe('hard');
      expect(expectation?.requireJudge, `${file}/${id}`).toBe(true);
      expect(expectation?.minScore, `${file}/${id}`).toBe(minScore);
    }
  });
});

describe('Support assessment oracle hardening keeps defect detection (2026-09-17, items 1-10)', () => {
  it('Diana ledger is cumulative on every turn: 0/0/0, 1/1/0, 1/1/0', async () => {
    const diana = await loadCase('live-behavior-host-withdrawal-diana.yaml');
    expect(diana.version).toBe(5);
    expect(effectCounts(diana, 'no-handoff-effect-before-policy-turn')).toEqual([0, 0, 0]);
    expect(effectCounts(diana, 'single-handoff-effect-after-policy-turn')).toEqual([1, 1, 0]);
    expect(effectCounts(diana, 'one-handoff-effect-in-thread')).toEqual([1, 1, 0]);
  });

  it('pending-question turn0 accepts a bounded question or both labeled times; turn1 answers regardless', async () => {
    const pending = await loadCase('live-behavior-support-pending-question-completed.yaml');
    const turn0 = rubric(pending, 'turn0-ambiguous-time-asks-bounded-selection');
    expect(turn0).toMatch(/bounded question/);
    expect(turn0).toMatch(/both candidate times/);
    expect(turn0).toMatch(/correctly labeled/);
    expect(turn0).toMatch(/must not swap/);
    const turn1 = rubric(pending, 'turn1-reference-answered-grounded');
    expect(turn1).toMatch(/Regardless of whether turn0/);
    expect(turn1).toMatch(/same turn/);
    expect(turn1).toMatch(/must not ask another clarifying question/);
  });

  it('thanks accepts suppressed delivery or a brief ack; Yape is a recorded method, not proof of payment', async () => {
    const ownerPayment = await loadCase('live-behavior-owner-customer-payment-relevance.yaml');
    expect(ownerPayment.version).toBe(5);
    const thanks = rubric(ownerPayment, 'thanks-closes-without-restart');
    expect(thanks).toMatch(/empty assistant response is fully correct/);
    expect(thanks).toMatch(/brief natural acknowledgment/);
    expect(rubric(ownerPayment, 'payment-reply-answers-from-payment-evidence')).toMatch(
      /names only the recorded payment method/,
    );
  });

  it('accountless mixed answers permit only fixture-authorized roots with a consistent disclosure rubric', async () => {
    const mixed = await loadCase('live-behavior-accountless-event-before-private-auth.yaml');
    expect(mixed.version).toBe(5);
    const reads = mixed.expectations.find(
      (candidate) => candidate.id === 'reads-and-reuses-phone-enriched-event',
    );
    expect(reads?.mustCall).toContain('lookup_guest_events_by_phone');
    expect(reads?.mustNotCall ?? []).not.toContain('lookup_guest_orders_by_phone');
    expect(reads?.mustNotCall ?? []).not.toContain('lookup_guest_gift_purchases_by_phone');
    expect(reads?.mustNotCall).toContain('guest_rsvp');
    const text = rubric(mixed, 'answers-event-and-reuses-scoped-purchase');
    expect(text).toMatch(/account-wide lookup beyond/);
    expect(text).toMatch(/need not name any card method/);
    expect(mixed.expectations.some((candidate) => candidate.id === 'summary-excludes-payment-type')).toBe(
      false,
    );
  });

  it('no node, route, previous-node, retry-count, or persist-reason pins remain in the panel', async () => {
    for (const file of [
      'live-behavior-support-pending-question-completed.yaml',
      'live-behavior-accountless-guest-event.yaml',
      'live-behavior-purchase-martha-accountless.yaml',
      'live-behavior-owner-customer-payment-relevance.yaml',
      'live-behavior-current-campaign-order-maria-jose.yaml',
      'live-behavior-customer-event-task-continuity.yaml',
      'live-behavior-rsvp-unmatched-named-event-no-mutation.yaml',
      'live-behavior-s11-rsvp-durability.yaml',
      'live-behavior-rsvp-host-set-declining-consistent.yaml',
      'live-behavior-rsvp-plus-one-not-eligible.yaml',
      'live-behavior-host-withdrawal-diana.yaml',
      'live-behavior-otp-terminal-handoff-unknown.yaml',
      'live-behavior-auth-refusal-closes-query.yaml',
      'live-behavior-accountless-event-before-private-auth.yaml',
      'live-behavior-continuity-text-image-same-turn.yaml',
      'live-behavior-image-file-delayed-question.yaml',
      'live-behavior-continuity-question-needs-image.yaml',
      'live-behavior-image-expired-reference.yaml',
      'live-behavior-s01-frozen-world-identity.yaml',
      'live-behavior-concurrent-support-turns.yaml',
      'live-behavior-owner-planning-to-faq-transfer.yaml',
      'live-behavior-spanish-only.yaml',
      'live-feedback-token-close-flow.yaml',
      'live-behavior-jose-campaign-acknowledgement.yaml',
    ]) {
      const cases = await loadCase(file);
      for (const expectation of cases.expectations) {
        expect(expectation.type, `${file}/${expectation.id}`).not.toBe('node_transition');
        if (expectation.type === 'trace_field_equals') {
          expect(
            ['previous_node', 'route_kind', 'plan_persist_reason'],
            `${file}/${expectation.id}`,
          ).not.toContain(
            (expectation as unknown as { path?: string }).path,
          );
        }
        if (expectation.type === 'trace_field_number') {
          expect((expectation as unknown as { path?: string }).path, `${file}/${expectation.id}`).not.toBe(
            'turn_coordination.attempts',
          );
        }
      }
    }
  });

  it('replaced pins prove the same invariants from receipts, reads, and judges', async () => {
    const s11 = await loadCase('live-behavior-s11-rsvp-durability.yaml');
    expect(s11.version).toBe(4);
    expect(effectCounts(s11, 'remains-in-rsvp-node')).toEqual([0, 0, 0]);
    const plusOne = await loadCase('live-behavior-rsvp-plus-one-not-eligible.yaml');
    expect(plusOne.version).toBe(2);
    expect(effectCounts(plusOne, 'enters-rsvp-node')).toEqual([0, 0, 0]);
    const s01 = await loadCase('live-behavior-s01-frozen-world-identity.yaml');
    expect(s01.version).toBe(3);
    expect(effectCounts(s01, 's01-frozen-enters-information')).toEqual([0, 0, 0]);
    const martha = await loadCase('live-behavior-purchase-martha-accountless.yaml');
    expect(martha.version).toBe(4);
    expect(effectCounts(martha, 'martha-enters-information')).toEqual([0, 0, 0]);
    const refusal = await loadCase('live-behavior-auth-refusal-closes-query.yaml');
    expect(refusal.version).toBe(2);
    expect(effectCounts(refusal, 'refusal-returns-to-resume-node')).toEqual([0, 0, 0]);
    const faq = await loadCase('live-behavior-owner-planning-to-faq-transfer.yaml');
    expect(faq.version).toBe(3);
    const faqPin = faq.expectations.find(
      (candidate) => candidate.id === 'faq-turn-enters-information',
    );
    expect(faqPin?.type).toBe('fixture_effect_count');
  });

  it('delayed image asserts suppression, next-turn usability, and zero effects without the persist string', async () => {
    const delayed = await loadCase('live-behavior-image-file-delayed-question.yaml');
    expect(delayed.version).toBe(4);
    expect(
      delayed.expectations.some((candidate) => candidate.type === 'trace_field_equals'),
      'no trace string pin may remain',
    ).toBe(false);
    const firstTurn = delayed.expectations.find(
      (candidate) => candidate.id === 'file-image-first-turn-silent-persist-reason',
    );
    expect(firstTurn?.type).toBe('text_semantic');
    expect(firstTurn?.severity).toBe('hard');
    expect(firstTurn?.requireJudge).toBe(true);
    expect(firstTurn?.minScore).toBe(0.8);
    expect(rubric(delayed, 'file-image-first-turn-silent-persist-reason')).toMatch(
      /image-only silence is legitimate/,
    );
    expect(effectCounts(delayed, 'file-image-first-turn-no-rsvp-effect')).toEqual([0, 0, 0]);
    expect(effectCounts(delayed, 'file-image-first-turn-no-handoff-effect')).toEqual([0, 0, 0]);
    const persists = delayed.expectations.find(
      (candidate) => candidate.id === 'file-image-first-turn-persists',
    );
    expect(persists?.mustCall).toContain('image_file_context');
  });

  it('conversational blacklists are gone while hard semantic bans stay', async () => {
    const plusOne = await loadCase('live-behavior-rsvp-plus-one-not-eligible.yaml');
    const noFalse = plusOne.expectations.find((candidate) => candidate.id === 'no-false-success');
    expect(noFalse?.phrases).toEqual(['saved=true']);
    expect(rubric(plusOne, 'not-eligible-reported-honestly')).toMatch(/never claim the companion was registered/);
    const spanish = await loadCase('live-behavior-spanish-only.yaml');
    expect(spanish.version).toBe(3);
    const banned = spanish.expectations.find(
      (candidate) => candidate.id === 'no-known-english-interface-terms',
    );
    const phrases = (banned?.phrases ?? []).join('\n').toLowerCase();
    expect(phrases).not.toContain('email');
    expect(phrases).not.toContain('link');
    expect(phrases).not.toContain('\nweb\n');
    for (const [file, gone, kept] of [
      ['live-behavior-owner-customer-payment-relevance.yaml', 'payment-reply-excludes-cart', /abandoned cart/],
      ['live-behavior-continuity-text-image-same-turn.yaml', 'same-turn-no-resend-request', /must not ask the user to resend/],
      ['live-behavior-continuity-question-needs-image.yaml', 'needs-image-second-turn-no-resend', /must not ask the user to resend/],
      ['live-behavior-image-file-delayed-question.yaml', 'file-image-delayed-no-resend', /must not ask the user to resend/],
      ['live-behavior-image-expired-reference.yaml', 'expired-no-invented-content', /must not confirm or approve any payment/],
    ] as Array<[string, string, RegExp]>) {
      const cases = await loadCase(file);
      expect(cases.expectations.some((candidate) => candidate.id === gone), `${file}/${gone}`).toBe(false);
      const banKept = cases.expectations.some(
        (candidate) => candidate.type === 'text_semantic' && kept.test(candidate.rubric ?? ''),
      );
      expect(banKept, `${file} keeps the hard semantic ban`).toBe(true);
    }
  });

  it('every actionable panel turn has a hard semantic judge; added budget is three calls', async () => {
    // Added judges: concurrent turn0, planning-interview turn1, delayed-image turn0.
    // Token close-flow intermediate turns stay structural (contact-collection statements, not
    // actionable questions): no-submit, provider-preserved, and no-early-search pins plus the
    // final submission judge. Jose turn0 (greeting) and delayed turn0 image-only input are not
    // actionable questions either; the delayed silence judge still covers that turn.
    for (const [file, id, minScore, turnIndex] of [
      ['live-behavior-concurrent-support-turns.yaml', 'first-support-question-answered', 0.9, 0],
      ['live-behavior-owner-planning-to-faq-transfer.yaml', 'planning-turn-continues-interview', 0.85, 1],
      ['live-behavior-image-file-delayed-question.yaml', 'file-image-first-turn-silent-persist-reason', 0.8, 0],
    ] as Array<[string, string, number, number]>) {
      const cases = await loadCase(file);
      const expectation = cases.expectations.find((candidate) => candidate.id === id);
      expect(expectation, `${file} is missing ${id}`).toBeDefined();
      expect(expectation?.type).toBe('text_semantic');
      expect(expectation?.severity).toBe('hard');
      expect(expectation?.requireJudge).toBe(true);
      expect(expectation?.minScore).toBe(minScore);
      expect(expectation?.turnIndex).toBe(turnIndex);
    }
    const close = await loadCase('live-feedback-token-close-flow.yaml');
    expect(close.version).toBe(2);
    const noSubmit = close.expectations.find(
      (candidate) => candidate.id === 'contact-details-alone-do-not-submit',
    );
    expect(noSubmit?.severity).toBe('hard');
  });

  it('image truth stays judge-only and digest-bound; runtime inputs carry no oracle facts', async () => {
    for (const [file, turn] of [
      ['live-behavior-continuity-text-image-same-turn.yaml', 0],
      ['live-behavior-image-file-delayed-question.yaml', 0],
      ['live-behavior-continuity-question-needs-image.yaml', 1],
    ] as Array<[string, number]>) {
      const raw = YAML.parse(
        await fs.readFile(path.join(CASE_DIR, file), 'utf8'),
      ) as unknown as {
        inputs: Array<{ image?: { data?: string } }>;
        judgeGroundTruth?: { imageDigest?: string; verifiedAmount?: string; boundInputTurn?: number };
      };
      const truth = raw.judgeGroundTruth;
      expect(truth, `${file} keeps judge-only ground truth`).toBeDefined();
      expect(truth?.boundInputTurn).toBe(turn);
      const imageData = raw.inputs[turn]?.image?.data;
      expect(typeof imageData).toBe('string');
      const digest = crypto.createHash('sha256').update(imageData as string, 'utf8').digest('hex');
      expect(digest, `${file} truth binds the exact attachment bytes`).toBe(truth?.imageDigest);
      expect(truth?.verifiedAmount).toBeTruthy();
      const cases = await loadCase(file);
      const semantic = cases.expectations.find((candidate) => candidate.type === 'text_semantic' && candidate.turnIndex === (file.includes('delayed') ? 1 : turn));
      expect(semantic?.rubric ?? '', `${file} reads pixels without proving approval`).toMatch(
        /never backend payment approval/,
      );
    }
  });

  it('takeover receipts prove submission only; bare acknowledgments stay valid', async () => {
    const diana = await loadCase('live-behavior-host-withdrawal-diana.yaml');
    expect(rubric(diana, 'supported-policy-not-invented-withdrawal-status')).toMatch(
      /human support was requested/,
    );
    expect(rubric(diana, 'later-event-message-stays-with-human-team')).toMatch(/no new confirmed effect fails/);
    const close = await loadCase('live-feedback-token-close-flow.yaml');
    expect(rubric(close, 'correct-close-behavior')).toMatch(/submission/);
    const jose = await loadCase('live-behavior-jose-campaign-acknowledgement.yaml');
    expect(rubric(jose, 'acknowledgement-closes-without-repeated-welcome-or-interview')).toMatch(
      /empty assistant response is fully correct/,
    );
  });
});
