import path from 'node:path';

import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { PromptLoader } from '../src/runtime/prompt-loader';
import {
  compareStaticPromptShapes,
  legacyPromptBaselineRef,
} from '../src/audit/static-prompt-comparison';
import { measureHistoricalBranches, measureCurrentBranches } from '../src/audit/prompt-branch-measurement';

describe('static prompt comparison', () => {
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

  it('proves every route-scoped prompt is leaner than the historical baseline', async () => {
    const result = await compareStaticPromptShapes({
      loader,
      counterModel: 'gpt-5.6-luna',
      generatedAt: '2026-08-04T00:00:00.000Z',
    });

    expect(result.baselineRef).toBe(legacyPromptBaselineRef);
    expect(result.comparisons).toHaveLength(36);
    expect(result.violations).toEqual([]);
    expect(result.summary.currentSerializedRequestBytes)
      .toBeLessThan(result.summary.baselineSerializedRequestBytes);
    expect(result.summary.serializedRequestByteReductionPercent).toBeGreaterThan(20);
    expect(route(result, 'classifier').serializedRequestByteReductionPercent)
      .toBeGreaterThan(-5);
    expect(route(result, 'classifier:campaign_reply').serializedRequestByteReductionPercent)
      .toBeGreaterThan(50);
    expect(route(result, 'extractor:conversation_only').current.fileCount).toBe(1);
    // Contract revision (Lane B extractor relevance): style/personality
    // modules excluded from the extractor bundle, one fewer file.
    expect(route(result, 'extractor:shortlist').current.fileCount).toBe(5);
    expect(route(result, 'extractor:rsvp').current.fileCount).toBe(2);
    expect(route(result, 'contacto_inicial').current.fileCount).toBe(7);
    expect(route(result, 'recomendar').current.fileCount).toBe(10);
    expect(route(result, 'resolver_consultas_informativas').current.fileCount).toBe(7);
    expect(route(result, 'responder_invitacion').current.fileCount).toBe(7);
    expect(route(result, 'reset_plan').current.fileCount).toBe(10);
  }, 20_000);

  it('uses non-generative input-token counting only when supplied', async () => {
    const count = vi.fn().mockResolvedValue({
      object: 'response.input_tokens',
      input_tokens: 100,
    });
    const openAIClient = {
      responses: { inputTokens: { count } },
    } as unknown as OpenAI;

    const result = await compareStaticPromptShapes({
      loader,
      counterModel: 'gpt-5.6-luna',
      openAIClient,
    });

    expect(count).toHaveBeenCalledTimes(result.comparisons.length * 2);
    expect(result.comparisons.every(
      (comparison) => comparison.baseline.remoteInputTokens === 100 &&
        comparison.current.remoteInputTokens === 100,
    )).toBe(true);
    expect(result.violations).toHaveLength(result.comparisons.length - 2);
  }, 20_000);
});

describe('per-branch historical baseline via git show', () => {
  it('measures all branches from 78ae24e anchor without using working tree', async () => {
    const historical = await measureHistoricalBranches({
      anchorRef: '78ae24e',
      counterModel: 'gpt-5.6-luna',
    });
    expect(historical).toHaveLength(38);
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const current = await measureCurrentBranches({ loader, counterModel: 'gpt-5.6-luna' });
    expect(current).toHaveLength(38);
    // Historical and current share same branchId set
    expect(historical.map((branch) => branch.branchId).sort()).toEqual(
      current.map((branch) => branch.branchId).sort(),
    );
    // RSVP branches exist in historical baseline
    expect(historical.some((branch) => branch.branchId === 'responder_invitacion:resolved_single')).toBe(true);
    expect(historical.some((branch) => branch.branchId === 'responder_invitacion:needs_event_selection')).toBe(true);
    // Anchor instruction bytes for responder_invitacion are 8233 (stable anchor)
    const anchorRsvp = historical.find((branch) => branch.branchId === 'responder_invitacion:resolved_single');
    expect(anchorRsvp?.instructionBytes).toBe(8233);
    expect(anchorRsvp?.fileCount).toBe(7);
    // Read-only RSVP offer guidance removes 27 bytes from the prior 8448-byte bundle.
    // 2026-09-11 step C grounding: +534 bytes for evidence-driven RSVP wording
    // (no-write clarity, plus-one/multi-person honesty, reminder-mismatch
    // framing) replacing the retired deterministic-fragment/tissue mechanism.
    // 2026-09-14 R7 grounding-continuity: +97 bytes for one R7 line
    // (plus_one_support_offer_required always carries the human-support
    // offer). Previous pin 8955.
    // 2026-09-14 Packet C intent preservation: -18 bytes for softening the
    // mandated no-change status restatement in
    // responder_invitacion/response_contract.txt (gratitude/no-new-request
    // turns keep the no-new-write honesty without a forced status
    // paragraph). Previous pin 9052.
    // 2026-09-15 tissue-removal reconciliation: pin 9034 matches neither
    // clean HEAD (8421) nor this tree (8858, verified by measurement).
    // The HEAD-to-tree diff was verified Spanish-only with no scripted
    // prose: the deterministic-fragment tissue paragraph is replaced by a
    // model-written reply rule, plus campaign-reminder honesty and
    // plus-one/multi-person honesty lines. No wording added to satisfy the
    // pin; the pin follows the intended removals. Previous pin 9034.
    // 2026-09-15 date-only RSVP enumeration removal: selection turns defer
    // to projected event facts (including rsvp_event_time.hour24) instead
    // of enumerating nombre+fecha as complete; model-written sentences
    // only. Previous pin 8858.
    // 2026-09-15 confirmation-hour fact: the confirmation sentence states
    // rsvp_event_time.hour24 when projected, so the Marta turn can carry
    // 19:00; responder response_contract stays mandate-free. Previous pin
    // 8872.
    // 2026-09-16 P3 useful completeness: +94 bytes in responder_invitacion
    // (venue-when-useful, answer-every-part, brief-not-paragraph rule). No
    // fixed prose; hard paragraph mandates removed. Previous pin 8933.
    // 2026-09-16 oracle-audit hostdecl hedge grounding: +281 bytes in
    // responder_invitacion (verified-record states/dates question, no false
    // cannot-verify hedge when grounded). Model wording only. Previous pin 9027.
    // 2026-09-16 customer-support subtractive pass: companion verification
    // scope wording in responder_invitacion/system.txt plus shared grounding
    // invariants in base_system.txt, minus shared-prompt tightening that
    // removed the node-obedience recital and capability-list verbosity.
    // Net +49 on this branch; customer-turn instructions sit below the
    // 1c15bce7 baseline on every measured scenario. Previous pin 9308.
    // 2026-09-17 actionable-answer directive: +267 bytes for the single
    // shared resolve-before-replying invariant in base_system.txt (net of
    // the -19B support_continuity recital removal on other branches).
    // Previous pin 9357.
    const currentRsvp = current.find((branch) => branch.branchId === 'responder_invitacion:resolved_single');
    // Static legacy bundles are diagnostic only; reductions are allowed.
    // The production request is pinned separately by captured-spec tests.
    expect(currentRsvp?.instructionBytes).toBeLessThanOrEqual(9266);
    expect((currentRsvp?.instructionBytes ?? 0) - (anchorRsvp?.instructionBytes ?? 0)).toBeLessThanOrEqual(1033);
  }, 20_000);
});

function route(
  result: Awaited<ReturnType<typeof compareStaticPromptShapes>>,
  routeName: string,
) {
  const comparison = result.comparisons.find(
    (candidate) => candidate.route === routeName,
  );
  if (!comparison) {
    throw new Error(`Missing comparison for ${routeName}.`);
  }
  return comparison;
}
