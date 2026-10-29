import fs from 'node:fs/promises';
import path from 'node:path';

import { decisionNodes } from '../core/decision-nodes';
import {
  conversationPromptFilesForNode,
  extractorPromptFilesForCapabilities,
  instructionModuleRegistry,
  responseClassifierPromptFiles,
  nodePromptManifest,
} from '../runtime/prompt-manifest';
import { extractorAuditProfiles } from './prompt-audit';
import { routerInputTemplatePath } from '../runtime/decisions-router-input';
import { routerQuestionPromptFiles } from '../runtime/decisions-router-questions';

export type PromptInventoryConsumer = {
  callType: 'classifier' | 'extraction' | 'reply' | 'deterministic_reply' | 'router';
  nodes: string[];
  profiles: string[];
  transitions: string[];
  loader: string;
  reachability: 'production' | 'audit_only';
};

export type PromptInventoryEntry = {
  filePath: string;
  consumers: PromptInventoryConsumer[];
  isOrphaned: boolean;
  classification: 'production' | 'audit_only' | 'archived' | 'orphan';
  retirementReason?: string;
};

export type PromptInventory = {
  generatedAt: string;
  anchorRef: string | null;
  totalFiles: number;
  totalNodes: number;
  callTypes: string[];
  entries: PromptInventoryEntry[];
  unmappedFiles: string[];
};

/** Explicit historical retention is different from a fabricated loader chain. */
export const archivedPromptFiles: Readonly<Record<string, string>> = {
  'nodes/resolver_consultas_informativas/approval_limits.txt': 'Retained historical purchase guidance; production now uses typed payment evidence and payment_disclosure.txt.',
  'nodes/resolver_consultas_informativas/gift_fulfillment.txt': 'Retained historical fulfillment prose; production carries typed fulfillment facts without this module.',
};

export async function buildPromptInventory(args: {
  promptsDir: string;
  anchorRef?: string | null;
  generatedAt?: string;
}): Promise<PromptInventory> {
  const allFiles = await listAllPromptFiles(args.promptsDir);
  const entries: PromptInventoryEntry[] = [];

  for (const filePath of allFiles) {
    const consumers = deriveConsumers(filePath);
    const retirementReason = archivedPromptFiles[filePath];
    const isOrphaned = consumers.length === 0 && !retirementReason;
    entries.push({
      filePath,
      consumers,
      isOrphaned,
      classification: consumers.some((consumer) => consumer.reachability === 'production')
        ? 'production' : consumers.length > 0 ? 'audit_only' : retirementReason ? 'archived' : 'orphan',
      ...(retirementReason ? { retirementReason } : {}),
    });
  }

  const unmappedFiles = entries.filter((entry) => entry.isOrphaned).map((entry) => entry.filePath);

  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    anchorRef: args.anchorRef ?? null,
    totalFiles: allFiles.length,
    totalNodes: decisionNodes.length,
    callTypes: ['classifier', 'extraction', 'reply', 'deterministic_reply', 'router'],
    entries: entries.sort((a, b) => a.filePath.localeCompare(b.filePath)),
    unmappedFiles,
  };
}

/** Only executable compiler/loader registries establish production reachability. */
function deriveConsumers(filePath: string): PromptInventoryConsumer[] {
  const consumers: PromptInventoryConsumer[] = [];
  for (const [moduleId, meta] of Object.entries(instructionModuleRegistry)) {
    if (!meta.files.includes(filePath)) continue;
    for (const stage of meta.stages) {
      consumers.push({
        callType: stage,
        nodes: [], profiles: [], transitions: [`compiler:${moduleId}`],
        loader: `PromptLoader.loadModuleFilesBundle -> instructionModuleRegistry:${moduleId} (${meta.consumer})`,
        reachability: 'production',
      });
    }
  }
  const conditionalExtractionFiles: Readonly<Record<string, string>> = {
    'extractors/image_reference.txt': 'stored image attachment references exist',
    'extractors/campaign_reference.txt': 'provenance-bound campaign reference exists',
    'extractors/continuity.txt': 'unanchored conversation continuity needs structured interpretation',
    'extractors/otp_continuation.txt': 'protected pending OTP continuation exists',
  };
  const conditional = conditionalExtractionFiles[filePath];
  if (conditional) {
    consumers.push({
      callType: 'extraction', nodes: [], profiles: [conditional],
      transitions: [`extraction:${filePath}`],
      loader: `OpenAiAgentRuntime.buildExtractionRequestSpec -> PromptLoader.loadModuleFilesBundle (${conditional})`,
      reachability: 'production',
    });
  }
  const routerFiles: readonly string[] = [...Object.values(routerQuestionPromptFiles), routerInputTemplatePath];
  if (routerFiles.includes(filePath)) {
    consumers.push({
      callType: 'router', nodes: [], profiles: [], transitions: ['router:decisions_router'],
      loader: 'loadRouterQuestions / loadRouterInputTemplate -> PromptLoader.loadModuleFilesBundle',
      reachability: 'production',
    });
  }
  for (const [profile, files] of Object.entries(responseClassifierPromptFiles)) {
    if (!(files as readonly string[]).includes(filePath)) continue;
    consumers.push({
      callType: 'classifier', nodes: ['deteccion_intencion'], profiles: [profile],
      transitions: [`classifier:${profile}`],
      loader: 'PromptLoader.loadResponseClassifierBundle -> responseClassifierPromptFiles',
      reachability: 'production',
    });
  }
  // Legacy bundles remain inspectable for historical comparisons. They do not
  // establish that a file reaches production's module-selected model request.
  const legacyNodes = decisionNodes.filter((node) =>
    [...conversationPromptFilesForNode(node), ...nodePromptManifest[node].files].includes(filePath),
  );
  if (legacyNodes.length > 0) {
    consumers.push({
      callType: 'reply', nodes: [...legacyNodes], profiles: [],
      transitions: legacyNodes.map((node) => `audit:reply:${node}`),
      loader: 'retired from production reply; audit measurement only via PromptLoader.loadNodeBundle',
      reachability: 'audit_only',
    });
  }
  const legacyProfiles = extractorAuditProfiles.filter((profile) =>
    extractorPromptFilesForCapabilities(profile.capabilities).includes(filePath),
  );
  if (legacyProfiles.length > 0) {
    consumers.push({
      callType: 'extraction', nodes: [], profiles: legacyProfiles.map((profile) => profile.name),
      transitions: legacyProfiles.map((profile) => `audit:extraction:${profile.name}`),
      loader: 'retired from production extraction; audit measurement only via PromptLoader.loadExtractorBundle',
      reachability: 'audit_only',
    });
  }
  if (filePath === 'nodes/resolver_consultas_informativas/image_inspection.txt') {
    consumers.push({
      callType: 'reply', nodes: ['resolver_consultas_informativas'], profiles: ['image'],
      transitions: ['audit:retired_image_inspection'],
      loader: 'retired describe-by-default; PromptLoader.loadImageBundle (no service call sites)',
      reachability: 'audit_only',
    });
  }
  return consumers;
}

async function listAllPromptFiles(promptsDir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(currentDir: string, relativePrefix: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.join(relativePrefix, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  }
  await walk(promptsDir, '');
  return results.sort();
}
