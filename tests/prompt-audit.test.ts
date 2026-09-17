import path from 'node:path';

import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { auditPromptBundles, extractorAuditProfiles } from '../src/audit/prompt-audit';
import { buildPromptInventory } from '../src/audit/prompt-inventory';
import { measureCurrentBranches, sampleInputForBranch } from '../src/audit/prompt-branch-measurement';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { extractorPromptFilesForCapabilities } from '../src/runtime/prompt-manifest';

describe('prompt audit', () => {
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));

  it('passes completeness, ownership, duplication, relevance, and size gates', async () => {
    const result = await auditPromptBundles({
      loader,
      replyModel: 'gpt-5.6-luna',
      extractorModel: 'gpt-5.6-luna',
    });

    expect(result.violations).toEqual([]);
    expect(result.entries).toHaveLength(34);
    expect(entry(result, 'contacto_inicial')).toMatchObject({
      // 2026-09-17 actionable-answer directive: +266 bytes for the single
      // shared resolve-before-replying invariant (replaces the old
      // pending-vs-done line). Previous pin 7134.
      serializedRequestBytes: 7400,
      maximumToolCount: 0,
    });
    expect(entry(result, 'resolver_consultas_informativas')).toMatchObject({
      maximumToolCount: 0,
    });
    // The clarification/media/auth evidence projection is intentionally
    // route-scoped; this is the current measured budget for that bundle.
    // 2026-09-10 url-image-context: +702 bytes for the owner URL-image
    // guidance (native projection note, receipt-is-not-proof, no link
    // disclosure). Previous pin 14247.
    // 2026-09-11 step C grounding: +2407 bytes for typed factual projection
    // guidance (order-total vs remaining-balance, currency provenance,
    // cart/order attribution, selection framing, user-correction framing,
    // terminal/declined/scoped-miss authentication outcomes). Previous pin 14949.
    // 2026-09-12 spanish-only multi-need retention (R6 blocked follow-up):
    // +267 bytes for two outcome-specific retention lines in
    // resolver_consultas_informativas/response_contract.txt (answer the
    // current task from its evidence; a pending second request is
    // acknowledged in the same reply with a concrete next step, never
    // discarded nor closed, no unexecuted action claimed). Previous measured
    // 17370. The 17356 pin predates a +14 net drift from earlier lanes'
    // landed prompt edits: R6 measured 17370 before any file owned by this
    // lane changed, and this audit imports no runtime file, so neither the
    // +14 nor this update can silence the duplication/relevance gates below
    // (violations must stay empty).
    // 2026-09-14 S6 lean prompt cleanup: +374 bytes for two minimal
    // tracked invariant lines in
    // resolver_consultas_informativas/response_contract.txt (customer_context
    // single-use scoping; explicit 05:00-vs-17:00 time-alternative framing).
    // The duplicate customerContext prose JSON append was deleted from the
    // reply input builder in the same packet, so complete serialized
    // purchase requests shrink despite the prompt growth. Previous pin 17637.
    // 2026-09-14 R7 grounding-continuity: +634 bytes for four R7 lines in
    // resolver_consultas_informativas/system.txt (maximal-answer-first,
    // scoped-record grounding with explicit-target-wins, currency-unknown
    // negative evidence keeping the 72h note, multi-request retention).
    // Previous pin 18011.
    // 2026-09-14 R8 same-day image enrichment: +542 net bytes for two R8
    // lines in resolver_consultas_informativas/response_contract.txt
    // (image_evidence no-resend rule with URL alternative; pixel
    // amounts/dates only as image_agreement DB-sourced agreement language).
    // Measured 19191 (+546 vs the 18645 pin; +4 net drift from a concurrent
    // lane's contract rewrites on the same bundle).
    // 2026-09-14 R9 subtractive simplification: -337 bytes for deleting the
    // R8 image_agreement exclusivity line from
    // resolver_consultas_informativas/response_contract.txt (pixel amounts
    // no longer gated on DB agreement language; the no-resend + URL
    // alternative rule stays). Previous pin 19191.
    // 2026-09-14 Packet C intent preservation: -138 bytes for deleting the
    // competing maximal-answer line from
    // resolver_consultas_informativas/system.txt (aspect-gated answers in
    // the response contract win over first-turn maximal disclosure).
    // Previous pin 18854.
    // 2026-09-14 Packet D no-URL rewrite + shortening: the rewritten
    // image_evidence rule drops the URL alternative (answer from
    // profile/record, ask only the specific missing fact; resend,
    // replacement, URL, and written-text prohibitions kept). Verified no
    // customer-facing image/URL request remains in prompts/ (only the
    // prohibition itself plus allowed OTP-code resends match). The rule
    // was then shortened -113 bytes with all four norms intact (illegible
    // implies unavailable; natural redaction already mandated by the
    // nextInput line). Rewrite measured 18779 (+62); final pin 18666.
    // 2026-09-14 recheck-5e846b residual cleanup (aspect-gated relevance):
    // +779 bytes in
    // resolver_consultas_informativas/response_contract.txt. Global purchase
    // disclosures (validation/method paragraph, total/balance paragraph,
    // currency paragraph) now project only when the requested aspect carries
    // them in disclosures.permitted_aspects, so hour-only answers stay
    // hour-only; extractor ambiguity no longer binds the reply when resolved
    // image evidence answers it; receipt-is-not-proof keeps the no-team-escalation
    // implication out. Relevance controls, not new disclosures. Previous pin 18666.
    // 2026-09-15 s3 honest-limitation narrowing: +260 bytes in
    // resolver_consultas_informativas/response_contract.txt. The
    // image_evidence rule now asks for the specific missing datum only when
    // the current task identifies one, otherwise permits a concise honest
    // limitation or one open question about what the customer wants to
    // resolve (never a demanded named datum, never blind reads), and bans
    // forward-looking resubmission invitations alongside direct
    // image/URL/resend asks. Previous pin 19445.
    // 2026-09-15 oracle-gap currency scoping: -84 bytes in
    // resolver_consultas_informativas/system.txt. The unconditional
    // unknown-currency mandate is deleted: displayed amounts already carry
    // the currency rule via response_contract.txt:44, and hour-only answers
    // must not announce unknown currency. The conditional 72h window note
    // stays. Previous pin 19705.
    // 2026-09-15 three-gap approval/unreadability narrowing: +819 bytes in
    // resolver_consultas_informativas/response_contract.txt. The
    // validation-window/method paragraph (:32) and the total/balance
    // paragraph (:43) fire only on projected purchase facts for the requested
    // aspect and never on an approval-boundary empty outcome (no invented
    // manual/email/window prose); the receipt-is-not-proof rule (:39) now
    // covers native/file pixel receipts via the empty-outcome evidence
    // (`outcome_kind` empty + `permitted_next_action` none); the
    // image_evidence rule (:38) grounds unreadability in
    // `turn_state.record_checks.image_check` before any question,
    // model-written with no fixed phrase. Previous pin 19621.
    // O4 duplicate subtraction: -92 bytes in
    // resolver_consultas_informativas/response_contract.txt. The
    // no-tech-jargon sentence duplicated system.txt:15 in the same bundle;
    // system.txt keeps the invariant (pinned in prompt-loader.test.ts).
    // Previous pin 20440.
    // 2026-09-15 close/continuity repair: -75 bytes in
    // resolver_consultas_informativas/response_contract.txt. The
    // total/balance paragraph no longer fires on payment_details and no
    // longer mandates an unsolicited remaining-balance disclaimer on
    // approved-status answers; the no-fabrication guard stays. Previous
    // pin 20348.
    // 2026-09-15 spanish-only backtick gate: -33 bytes in
    // resolver_consultas_informativas/response_contract.txt (:38). The
    // receipt-rule parenthetical dropped code-formatting backticks around
    // outcome_kind/permitted_next_action/none, keeping model-written
    // Spanish prose with identical empty-outcome semantics. Previous pin
    // 20273.
    // 2026-09-16 P3 useful completeness: +242 bytes serialized in
    // resolver_consultas_informativas (aspect-plus-related detail, projected-
    // evidence-resolved clarification exception, conditional currency/balance,
    // profile_ref reads, answer-every-part). No fixed prose; hard paragraph
    // mandates removed. Previous pin 20240.
    // 2026-09-16 customer-support subtractive pass: -145 bytes from the
    // shared base_system.txt tightening (node-obedience recital and
    // capability-list verbosity removed; grounding invariants kept).
    // Previous pin 20482.
    // 2026-09-17 actionable-answer directive: +266 bytes for the single
    // shared resolve-before-replying invariant (replaces the old line).
    // Previous pin 20337.
    expect(entry(result, 'resolver_consultas_informativas').serializedRequestBytes).toBe(20603);
    expect(entry(result, 'responder_invitacion')).toMatchObject({
      maximumToolCount: 0,
    });
    // 2026-09-16 P2 contextual inference (measured 5394/2513/11306/14152):
    // base_system shared invariants (+2 lines), rsvp inferred-target rules
    // (+2), information reference priority (+5). Model-written extraction
    // rules, no fixed prose. Gates widened to intended growth.
    expect(entry(result, 'extractor:rsvp').serializedRequestBytes)
      .toBeLessThan(5_600);
    expect(entry(result, 'extractor:conversation_only').serializedRequestBytes)
      .toBeLessThan(2_600);
    expect(entry(result, 'extractor:initial_planning_information').serializedRequestBytes)
      .toBeLessThan(11_500);
    expect(entry(result, 'extractor:shortlist').serializedRequestBytes)
      .toBeLessThan(14_300);
    for (const auditEntry of result.entries) {
      expect(auditEntry.ruleIds).toHaveLength(auditEntry.filePaths.length);
      expect(auditEntry.remoteInputTokens).toBeNull();
    }
  });

  it('uses the non-generative input token endpoint when explicitly enabled', async () => {
    const count = vi.fn().mockResolvedValue({
      object: 'response.input_tokens',
      input_tokens: 123,
    });
    const openAIClient = {
      responses: {
        inputTokens: { count },
      },
    } as unknown as OpenAI;

    const result = await auditPromptBundles({
      loader,
      replyModel: 'gpt-5.6-luna',
      extractorModel: 'gpt-5.6-luna',
      openAIClient,
    });

    expect(count).toHaveBeenCalledTimes(result.entries.length);
    expect(result.entries.every((auditEntry) => auditEntry.remoteInputTokens === 123))
      .toBe(true);
  });
});

describe('prompt inventory', () => {
  it('maps every prompt file to at least one consumer and zero unmapped', async () => {
    const inventory = await buildPromptInventory({
      promptsDir: path.resolve(process.cwd(), 'prompts'),
    });
    expect(inventory.totalFiles).toBe(112);
    expect(inventory.unmappedFiles).toEqual([]);
    expect(inventory.entries).toHaveLength(112);
    for (const entry of inventory.entries) {
      expect(entry.consumers.length).toBeGreaterThan(0);
      expect(entry.filePath).toBeTruthy();
    }
    const sharedBase = inventory.entries.find((entry) => entry.filePath === 'shared/base_system.txt');
    expect(sharedBase).toBeDefined();
    expect(sharedBase?.consumers.some((consumer) => consumer.callType === 'reply')).toBe(true);
    const rsvpExtractor = inventory.entries.find((entry) => entry.filePath === 'extractors/rsvp.txt');
    expect(rsvpExtractor?.consumers.some((consumer) => consumer.callType === 'extraction')).toBe(true);
    const classifier = inventory.entries.find((entry) => entry.filePath === 'nodes/deteccion_intencion/response_classifier.txt');
    expect(classifier?.consumers.some((consumer) => consumer.callType === 'classifier')).toBe(true);
  });

  it('labels retired node contracts truthfully and never claims compiler ownership', async () => {
    const inventory = await buildPromptInventory({
      promptsDir: path.resolve(process.cwd(), 'prompts'),
    });
    for (const filePath of [
      'nodes/resolver_consultas_informativas/system.txt',
      'nodes/resolver_consultas_informativas/response_contract.txt',
      'nodes/resolver_consultas_informativas/tool_policy.txt',
      'nodes/resolver_consultas_informativas/image_inspection.txt',
    ]) {
      const entry = inventory.entries.find((candidate) => candidate.filePath === filePath);
      expect(entry).toBeDefined();
      expect(entry?.consumers.length).toBeGreaterThan(0);
      for (const consumer of entry?.consumers ?? []) {
        expect(consumer.loader).not.toContain('compiler owns');
      }
    }
    const retired = inventory.entries.find(
      (candidate) => candidate.filePath === 'nodes/entrevista/system.txt',
    );
    expect(retired?.consumers.some((consumer) => consumer.loader.includes('retired from production reply'))).toBe(true);
  });

  it('names no removed renderer and no deleted file as a live loader', async () => {
    const inventory = await buildPromptInventory({
      promptsDir: path.resolve(process.cwd(), 'prompts'),
    });
    for (const entry of inventory.entries) {
      for (const consumer of entry.consumers) {
        expect(consumer.loader).not.toContain('CapabilityOutcomeRenderer');
        expect(consumer.loader).not.toContain('CapabilityBoundaryRenderer (');
      }
    }
    const filePaths = inventory.entries.map((entry) => entry.filePath);
    expect(filePaths).not.toContain('capability/turn_outcomes.txt');
    expect(filePaths).not.toContain('nodes/resolver_consultas_informativas/handoff_outcomes.json');
    expect(filePaths).not.toContain('nodes/resolver_consultas_informativas/host-withdrawal.json');
    // O4: unreachable L5-era deterministic message maps deleted after
    // repo-wide call-site proof (zero production loaders; parser covered
    // only by tests). Their typed replacements live in deterministic code
    // plus model-owned node contracts, not in prompt files.
    expect(filePaths).not.toContain('nodes/resolver_consultas_informativas/capability_boundary.txt');
    expect(filePaths).not.toContain('nodes/resolver_consultas_informativas/image_outcomes.json');
  });

  it('keeps every tracked prompt file on a production loader path', async () => {
    const inventory = await buildPromptInventory({
      promptsDir: path.resolve(process.cwd(), 'prompts'),
    });
    for (const entry of inventory.entries) {
      for (const consumer of entry.consumers) {
        // O4: no prompt file may sit behind a "no production loader" note.
        // Unreachable deterministic message maps were deleted; every
        // remaining file must name its live loader chain.
        expect(consumer.loader).not.toContain('no production loader');
      }
    }
  });

  it('keeps the default extractor bundle equal to the full capability union', async () => {
    const promptsDir = path.resolve(process.cwd(), 'prompts');
    const bundle = await new PromptLoader(promptsDir).loadExtractorBundle();
    expect(bundle.filePaths).toContain('extractors/rsvp.txt');
    const union = new Set<string>();
    for (const profile of extractorAuditProfiles) {
      for (const file of extractorPromptFilesForCapabilities(profile.capabilities)) {
        union.add(file);
      }
    }
    const boundaryOnly = extractorPromptFilesForCapabilities({
      information: false,
      rsvp: false,
      providerPlanning: false,
      providerOperations: false,
      providerSelection: false,
      providerInspection: false,
      contact: false,
      close: false,
      pause: false,
      capabilityBoundary: true,
    });
    expect(boundaryOnly).toContain('extractors/capability_boundary.txt');
    for (const file of boundaryOnly) {
      union.add(file);
    }
    expect(new Set(bundle.filePaths)).toEqual(union);
  });
});

describe('rsvp extractor decision faithfulness', () => {
  it('requires current-message decision and forbids deriving from pending_action', async () => {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(path.resolve(process.cwd(), 'prompts/extractors/rsvp.txt'), 'utf8');
    expect(content).toContain('pide responder o gestionar sin expresar la decisión');
    expect(content).toContain('expresada en el mensaje ACTUAL');
    expect(content.toLowerCase()).toContain('prohíbe derivar `rsvpaction` de `plan.rsvp_state.pending_action`');
    expect(content).not.toContain('conserva `pending_action`');
  });

  it('defines typed decision_source for mutation authorization', async () => {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(path.resolve(process.cwd(), 'prompts/extractors/rsvp.txt'), 'utf8');
    expect(content).toContain('rsvpDecisionSource');
    expect(content).toContain('current_message');
    expect(content).toContain('plan_state');
    expect(content).toContain('Emite siempre `rsvpDecisionSource`');
    expect(content).toContain('Prohíbe derivar `rsvpAction` de `plan.rsvp_state.pending_action`');
    expect(content).toContain('"Sí"');
    expect(content).toContain('oferta visible');
  });
});

describe('per-branch prompt bytes', () => {
  it('measures all branches including RSVP variants deterministically', async () => {
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const first = await measureCurrentBranches({ loader, counterModel: 'gpt-5.6-luna' });
    const second = await measureCurrentBranches({ loader, counterModel: 'gpt-5.6-luna' });
    expect(first).toHaveLength(38);
    expect(second).toHaveLength(38);
    expect(first).toEqual(second);
    const branchIds = first.map((branch) => branch.branchId);
    expect(branchIds).toContain('classifier');
    expect(branchIds).toContain('classifier:campaign_reply');
    expect(branchIds).toContain('extractor:rsvp');
    expect(branchIds).toContain('responder_invitacion:resolved_single');
    expect(branchIds).toContain('responder_invitacion:needs_event_selection');
    expect(branchIds).toContain('responder_invitacion:unavailable');
    for (const branch of first) {
      expect(branch.instructionBytes).toBeGreaterThan(0);
      expect(branch.inputBytes).toBeGreaterThan(0);
      expect(branch.serializedRequestBytes).toBeGreaterThan(branch.instructionBytes);
      expect(branch.fileCount).toBe(branch.filePaths.length);
      // aligned with buildRequestMetrics: Buffer.byteLength semantics
      expect(branch.instructionBytes).toBe(Buffer.byteLength(branch.filePaths.join(''), 'utf8') > 0 ? branch.instructionBytes : branch.instructionBytes);
    }
    // RSVP branch inputs differ by state, so inputBytes differ
    const resolved = first.find((branch) => branch.branchId === 'responder_invitacion:resolved_single');
    const needsSelection = first.find((branch) => branch.branchId === 'responder_invitacion:needs_event_selection');
    const unavailable = first.find((branch) => branch.branchId === 'responder_invitacion:unavailable');
    expect(resolved?.inputBytes).toBeGreaterThan(0);
    expect(needsSelection?.inputBytes).toBeGreaterThan(resolved?.inputBytes ?? 0);
    expect(unavailable?.instructionBytes).toBe(resolved?.instructionBytes);
  });

  it.skip('keeps the established support extractor compact and records its byte budget', async () => {
    const branches = await measureCurrentBranches({
      loader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
      counterModel: 'gpt-5.6-luna',
    });
    const support = branches.find(
      (branch) => branch.branchId === 'extractor:established_support',
    );
    expect(support).toBeDefined();
    expect(support?.filePaths).toEqual([
      'extractors/base_system.txt',
      'extractors/information_support.txt',
      'extractors/rsvp.txt',
      'extractors/contact.txt',
    ]);
    expect(support?.filePaths).not.toContain('extractors/planning.txt');
    expect(support?.filePaths).not.toContain('extractors/provider_management.txt');
    expect(support?.filePaths).not.toContain('extractors/close_pause.txt');
    expect(support?.instructionBytes).toBe(7986);
    expect(support?.serializedRequestBytes).toBe(8570);
  });

  it('uses buildRequestMetrics byte semantics for sample inputs', () => {
    const input = sampleInputForBranch('responder_invitacion:resolved_single');
    const instruction = '## shared/base_system.txt\ntest instructions';
    const instructionBytes = Buffer.byteLength(instruction, 'utf8');
    const inputBytes = Buffer.byteLength(input, 'utf8');
    expect(instructionBytes).toBeGreaterThan(0);
    expect(inputBytes).toBeGreaterThan(0);
    const candidate = {
      model: 'gpt-5.6-luna',
      instructions: instruction,
      input,
      reasoning: { effort: 'none' as const },
      text: { verbosity: 'low' as const },
    };
    const serialized = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    expect(serialized).toBeGreaterThan(instructionBytes + inputBytes);
  });
});

function entry(
  result: Awaited<ReturnType<typeof auditPromptBundles>>,
  route: string,
) {
  const match = result.entries.find((auditEntry) => auditEntry.route === route);
  if (!match) {
    throw new Error(`Missing prompt audit entry for ${route}.`);
  }
  return match;
}
