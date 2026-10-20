import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { decisionNodes } from '../src/core/decision-nodes';
import {
  buildRuntimeCapabilityManifest,
  runtimeOperationIds,
  runtimeToolOperationMap,
  type RuntimeOperationId,
} from '../src/runtime/capability-manifest';
import {
  capabilityConsumerEntries,
  capabilityConsumerMap,
  validateCapabilityConsumerMap,
  validateToolOperationMap,
  type CapabilityConsumerEntry,
} from '../src/runtime/capability-consumer-map';
import { nodePromptManifest } from '../src/runtime/prompt-manifest';

const promptsDir = path.resolve(process.cwd(), 'prompts');

const NOT_IMPLEMENTED_OPERATIONS = [
  'confirmation_document.send',
  'purchase.modify',
  'refund_or_withdrawal.execute',
] as const satisfies readonly RuntimeOperationId[];

const MODEL_REVIEWED_OPERATIONS = [
  'payment_proof.verify',
  'media.image.inspect',
] as const satisfies readonly RuntimeOperationId[];

/**
 * Node prompt files declared by the manifest that are absent from the given
 * prompts root. The same helper proves the real root is complete and proves
 * the check fails when a node file is removed.
 */
async function missingNodePromptFiles(
  root: string,
): Promise<string[]> {
  const missing: string[] = [];
  for (const node of decisionNodes) {
    for (const file of nodePromptManifest[node].files) {
      if (!file.startsWith('nodes/')) continue;
      try {
        await fs.access(path.join(root, file));
      } catch {
        missing.push(`${node}: ${file}`);
      }
    }
  }
  return missing;
}

describe('capability and node/tool snapshot', () => {
  it('has system, response_contract and tool_policy on disk for every decision node', async () => {
    expect(Object.keys(nodePromptManifest)).toHaveLength(decisionNodes.length);
    for (const node of decisionNodes) {
      const files = nodePromptManifest[node].files;
      expect(files, node).toContain(`nodes/${node}/system.txt`);
      expect(files, node).toContain(`nodes/${node}/response_contract.txt`);
      expect(files, node).toContain(`nodes/${node}/tool_policy.txt`);
    }
    expect(await missingNodePromptFiles(promptsDir)).toEqual([]);
  });

  it('maps every compose tool to a known operation id', () => {
    expect(validateToolOperationMap(runtimeToolOperationMap)).toEqual([]);
    for (const [tool, operation] of Object.entries(runtimeToolOperationMap)) {
      expect(tool.length).toBeGreaterThan(0);
      expect(runtimeOperationIds, tool).toContain(operation);
    }
  });

  it('classifies every runtime operation exactly once', () => {
    expect(validateCapabilityConsumerMap(capabilityConsumerMap)).toEqual([]);
    expect(capabilityConsumerEntries.map((entry) => entry.id)).toEqual([
      ...runtimeOperationIds,
    ]);
    for (const entry of capabilityConsumerEntries) {
      expect(entry.class.length).toBeGreaterThan(0);
      expect(entry.note.length).toBeGreaterThan(0);
    }
  });

  it('records FAQ and invitation nodes as tool-free by design', () => {
    // Design, not a defect: both nodes pre-execute their reads in the
    // orchestrator, so the model gets no tool to call.
    expect(nodePromptManifest.resolver_consultas_informativas.allowedTools).toEqual([]);
    expect(nodePromptManifest.responder_invitacion.allowedTools).toEqual([]);
  });

  it('keeps the model-reviewed operations available and classified model_review', () => {
    const manifest = buildRuntimeCapabilityManifest({
      configured: true,
      featureFlags: {
        faq: true,
        purchaseInformation: true,
        rsvp: true,
        humanTakeover: true,
      },
    });
    for (const id of MODEL_REVIEWED_OPERATIONS) {
      expect(manifest[id], id).toMatchObject({ available: true, reason: 'enabled' });
      expect(capabilityConsumerMap[id].class, id).toBe('model_review');
    }
  });

  it('classifies the not_implemented operations as unsupported', () => {
    const manifest = buildRuntimeCapabilityManifest({ configured: true });
    for (const id of NOT_IMPLEMENTED_OPERATIONS) {
      expect(manifest[id], id).toMatchObject({
        available: false,
        reason: 'not_implemented',
      });
      expect(capabilityConsumerMap[id].class, id).toBe('unsupported');
      expect(capabilityConsumerMap[id].consumers, id).toEqual([]);
    }
  });
});

describe('capability snapshot mutation check', () => {
  it('fails when a node prompt file is removed', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'recap-node-files-'));
    await fs.cp(promptsDir, tempRoot, { recursive: true });
    const removed = 'nodes/contacto_inicial/system.txt';
    await fs.rm(path.join(tempRoot, removed));

    const missing = await missingNodePromptFiles(tempRoot);
    expect(missing).toContain('contacto_inicial: nodes/contacto_inicial/system.txt');
    // The real prompts root stays complete.
    expect(await missingNodePromptFiles(promptsDir)).toEqual([]);

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('fails when a tool mapping is removed', () => {
    const brokenToolMap: Record<string, string | undefined> = {
      ...runtimeToolOperationMap,
    };
    delete brokenToolMap.finish_plan;

    expect(validateToolOperationMap(brokenToolMap)).toContainEqual({
      operation: 'finish_plan',
      problem: 'tool_without_operation',
    });
    expect(validateToolOperationMap(runtimeToolOperationMap)).toEqual([]);
  });

  it('fails when a tool mapping points at an unknown operation', () => {
    const brokenToolMap: Record<string, string | undefined> = {
      ...runtimeToolOperationMap,
      finish_plan: 'not.a.real.operation',
    };

    expect(validateToolOperationMap(brokenToolMap)).toContainEqual({
      operation: 'finish_plan',
      problem: 'tool_maps_to_unknown_operation',
    });
  });

  it('fails when an operation consumer is removed', () => {
    const brokenMap: Record<string, CapabilityConsumerEntry | undefined> = {
      ...capabilityConsumerMap,
    };
    delete brokenMap['faq.read'];

    expect(validateCapabilityConsumerMap(brokenMap)).toContainEqual({
      operation: 'faq.read',
      problem: 'missing_consumer_classification',
    });
    expect(validateCapabilityConsumerMap(capabilityConsumerMap)).toEqual([]);
  });

  it('fails when a classified operation loses its consumer', () => {
    const brokenMap: Record<string, CapabilityConsumerEntry | undefined> = {
      ...capabilityConsumerMap,
      'faq.read': {
        id: 'faq.read',
        class: 'backend_read',
        consumers: [],
        note: 'deliberately broken copy',
      },
    };

    expect(validateCapabilityConsumerMap(brokenMap)).toContainEqual({
      operation: 'faq.read',
      problem: 'classified_operation_without_consumer',
    });
  });

  it('fails when a write operation is not classified as an effect', () => {
    const brokenMap: Record<string, CapabilityConsumerEntry | undefined> = {
      ...capabilityConsumerMap,
      'rsvp.response.write': {
        id: 'rsvp.response.write',
        class: 'backend_read',
        consumers: capabilityConsumerMap['rsvp.response.write'].consumers,
        note: 'deliberately broken copy',
      },
    };

    expect(validateCapabilityConsumerMap(brokenMap)).toContainEqual({
      operation: 'rsvp.response.write',
      problem: 'write_operation_not_classified_as_effect',
    });
  });
});
