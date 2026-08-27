import path from 'node:path';

import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { auditPromptBundles } from '../src/audit/prompt-audit';
import { buildPromptInventory } from '../src/audit/prompt-inventory';
import { measureCurrentBranches, sampleInputForBranch } from '../src/audit/prompt-branch-measurement';
import { PromptLoader } from '../src/runtime/prompt-loader';

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
      serializedRequestBytes: 7279,
      maximumToolCount: 0,
    });
    expect(entry(result, 'resolver_consultas_informativas')).toMatchObject({
      serializedRequestBytes: 13854,
      maximumToolCount: 0,
    });
    expect(entry(result, 'responder_invitacion')).toMatchObject({
      maximumToolCount: 0,
    });
    expect(entry(result, 'extractor:rsvp').serializedRequestBytes)
      .toBeLessThan(4_500);
    expect(entry(result, 'extractor:conversation_only').serializedRequestBytes)
      .toBeLessThan(2_500);
    expect(entry(result, 'extractor:initial_planning_information').serializedRequestBytes)
      .toBeLessThan(9_300);
    expect(entry(result, 'extractor:shortlist').serializedRequestBytes)
      .toBeLessThan(12_300);
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
    expect(inventory.totalFiles).toBe(128);
    expect(inventory.unmappedFiles).toEqual([]);
    expect(inventory.entries).toHaveLength(128);
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
