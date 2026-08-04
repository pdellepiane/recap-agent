import type OpenAI from 'openai';

import { decisionNodes } from '../core/decision-nodes';
import type { PromptLoader, PromptBundle } from '../runtime/prompt-loader';
import {
  conversationPromptFilesForNode,
  extractorPromptFilesForCapabilities,
  nodePromptManifest,
} from '../runtime/prompt-manifest';
import type { ExtractionCapabilityProfile } from '../runtime/extraction-schemas';

export type PromptAuditEntry = {
  route: string;
  bundleId: string;
  filePaths: string[];
  ruleIds: string[];
  instructionBytes: number;
  serializedRequestBytes: number;
  maximumToolCount: number;
  remoteInputTokens: number | null;
};

export type PromptAuditResult = {
  entries: PromptAuditEntry[];
  violations: string[];
};

export async function auditPromptBundles(args: {
  loader: PromptLoader;
  replyModel: string;
  extractorModel: string;
  openAIClient?: OpenAI;
}): Promise<PromptAuditResult> {
  const entries: PromptAuditEntry[] = [];
  const violations: string[] = [];

  for (const node of decisionNodes) {
    const bundle = await args.loader.loadNodeBundle(node);
    const expectedFiles = [
      ...conversationPromptFilesForNode(node),
      ...nodePromptManifest[node].files,
    ];
    validateBundle(node, bundle, expectedFiles, violations);
    entries.push(await buildEntry({
      route: node,
      bundle,
      model: args.replyModel,
      maximumToolCount: nodePromptManifest[node].allowedTools.length,
      openAIClient: args.openAIClient,
    }));
  }

  for (const profile of extractorAuditProfiles) {
    const route = `extractor:${profile.name}`;
    const bundle = await args.loader.loadExtractorBundle(profile.capabilities);
    validateBundle(
      route,
      bundle,
      extractorPromptFilesForCapabilities(profile.capabilities),
      violations,
    );
    entries.push(await buildEntry({
      route,
      bundle,
      model: args.extractorModel,
      maximumToolCount: 0,
      openAIClient: args.openAIClient,
    }));
  }

  return { entries, violations };
}

async function buildEntry(args: {
  route: string;
  bundle: PromptBundle;
  model: string;
  maximumToolCount: number;
  openAIClient?: OpenAI;
}): Promise<PromptAuditEntry> {
  const candidate = {
    model: args.model,
    instructions: args.bundle.instructions,
    input: `Escenario de auditoría estructural: ${args.route}`,
    reasoning: { effort: 'none' as const },
    text: { verbosity: 'low' as const },
  };
  const serializedRequestBytes = Buffer.byteLength(
    JSON.stringify(candidate),
    'utf8',
  );
  const remoteInputTokens = args.openAIClient
    ? (await args.openAIClient.responses.inputTokens.count(candidate)).input_tokens
    : null;

  return {
    route: args.route,
    bundleId: args.bundle.id,
    filePaths: args.bundle.filePaths,
    ruleIds: args.bundle.ruleIds,
    instructionBytes: Buffer.byteLength(args.bundle.instructions, 'utf8'),
    serializedRequestBytes,
    maximumToolCount: args.maximumToolCount,
    remoteInputTokens,
  };
}

function validateBundle(
  route: string,
  bundle: PromptBundle,
  expectedFiles: readonly string[],
  violations: string[],
): void {
  collectDuplicates(bundle.filePaths).forEach((filePath) => {
    violations.push(`${route}: duplicate prompt file ${filePath}`);
  });
  collectDuplicates(bundle.ruleIds).forEach((ruleId) => {
    violations.push(`${route}: duplicate prompt rule ID ${ruleId}`);
  });
  for (const requiredFile of expectedFiles) {
    if (!bundle.filePaths.includes(requiredFile)) {
      violations.push(`${route}: missing required prompt file ${requiredFile}`);
    }
  }
  for (const filePath of bundle.filePaths) {
    if (!expectedFiles.includes(filePath)) {
      violations.push(`${route}: unrelated prompt file ${filePath}`);
    }
  }
  collectDuplicates(normalizedParagraphs(bundle.instructions)).forEach((paragraph) => {
    violations.push(`${route}: repeated normalized paragraph ${paragraph.slice(0, 80)}`);
  });
}

export const extractorAuditProfiles: Array<{
  name: string;
  capabilities: ExtractionCapabilityProfile;
}> = [
  {
    name: 'conversation_only',
    capabilities: extractionCapabilities(),
  },
  {
    name: 'initial_planning_information',
    capabilities: extractionCapabilities({
      information: true,
      providerPlanning: true,
      contact: true,
    }),
  },
  {
    name: 'active_plan',
    capabilities: extractionCapabilities({
      information: true,
      providerPlanning: true,
      providerOperations: true,
      contact: true,
      close: true,
      pause: true,
    }),
  },
  {
    name: 'shortlist',
    capabilities: extractionCapabilities({
      information: true,
      providerPlanning: true,
      providerOperations: true,
      providerSelection: true,
      providerInspection: true,
      contact: true,
      close: true,
      pause: true,
    }),
  },
];

function extractionCapabilities(
  overrides: Partial<ExtractionCapabilityProfile> = {},
): ExtractionCapabilityProfile {
  return {
    information: false,
    providerPlanning: false,
    providerOperations: false,
    providerSelection: false,
    providerInspection: false,
    contact: false,
    close: false,
    pause: false,
    ...overrides,
  };
}

export function normalizedParagraphs(instructions: string): string[] {
  return instructions
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph
      .replace(/^## .*\n/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLocaleLowerCase('es'))
    .filter(Boolean);
}

function collectDuplicates(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(
    (value, index) => values.indexOf(value) !== index,
  )));
}
