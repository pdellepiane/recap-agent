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
    expect(inventory.totalFiles).toBe(inventory.entries.length); // 2026-09-22 Owner B B9: +shared/reply_core.txt (production reply core)
    expect(inventory.unmappedFiles).toEqual([]);
    expect(inventory.entries.length).toBeGreaterThan(0);
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

  it('keeps inventory loader chains truthful: retired labels, live paths, no removed renderers', async () => {
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
    for (const entry of inventory.entries) {
      for (const consumer of entry.consumers) {
        expect(consumer.loader).not.toContain('CapabilityOutcomeRenderer');
        expect(consumer.loader).not.toContain('CapabilityBoundaryRenderer (');
        // O4: no prompt file may sit behind a "no production loader" note.
        // Unreachable deterministic message maps were deleted; every
        // remaining file must name its live loader chain.
        expect(consumer.loader).not.toContain('no production loader');
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
