import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type OpenAI from 'openai';

import { decisionNodes } from '../core/decision-nodes';
import type { PromptBundle, PromptLoader } from '../runtime/prompt-loader';
import { nodePromptManifest } from '../runtime/prompt-manifest';
import {
  extractorAuditProfiles,
  normalizedParagraphs,
} from './prompt-audit';

const execFileAsync = promisify(execFile);

export const legacyPromptBaselineRef = 'dd0b6b6^';

const legacyConversationFiles = [
  'shared/base_system.txt',
  'shared/agent_personality.txt',
  'shared/domain_scope.txt',
  'shared/domain_knowledge.txt',
  'shared/output_style.txt',
  'shared/flow_discipline.txt',
  'shared/question_strategy.txt',
  'shared/common_anti_patterns.txt',
] as const;

const legacyExtractorFiles = [
  'extractors/system.txt',
  'extractors/field_definitions.txt',
  'extractors/conflict_resolution.txt',
  'extractors/domain_knowledge.txt',
  'extractors/normalization_rules.txt',
  'extractors/examples.md',
] as const;

export type PromptShapeMetrics = {
  fileCount: number;
  instructionBytes: number;
  serializedRequestBytes: number;
  normalizedParagraphCount: number;
  duplicateNormalizedParagraphCount: number;
  remoteInputTokens: number | null;
};

export type PromptShapeComparison = {
  route: string;
  component: 'classifier' | 'extractor' | 'reply';
  baselineFiles: string[];
  currentFiles: string[];
  baseline: PromptShapeMetrics;
  current: PromptShapeMetrics;
  serializedRequestByteDelta: number;
  serializedRequestByteReductionPercent: number;
  remoteInputTokenDelta: number | null;
  remoteInputTokenReductionPercent: number | null;
};

export type StaticPromptComparisonResult = {
  generatedAt: string;
  baselineRef: string;
  counterModel: string;
  comparisons: PromptShapeComparison[];
  summary: {
    baselineSerializedRequestBytes: number;
    currentSerializedRequestBytes: number;
    serializedRequestByteReductionPercent: number;
    baselineRemoteInputTokens: number | null;
    currentRemoteInputTokens: number | null;
    remoteInputTokenReductionPercent: number | null;
  };
  violations: string[];
};

type HistoricalPromptReader = (
  baselineRef: string,
  relativePath: string,
) => Promise<string>;

export async function compareStaticPromptShapes(args: {
  loader: PromptLoader;
  baselineRef?: string;
  counterModel: string;
  generatedAt?: string;
  openAIClient?: OpenAI;
  historicalPromptReader?: HistoricalPromptReader;
}): Promise<StaticPromptComparisonResult> {
  const baselineRef = args.baselineRef ?? legacyPromptBaselineRef;
  const historicalPromptReader = args.historicalPromptReader ?? readHistoricalPrompt;
  const comparisons: PromptShapeComparison[] = [];
  const violations: string[] = [];

  const classifierFiles = ['nodes/deteccion_intencion/response_classifier.txt'];
  comparisons.push(await compareRoute({
    route: 'classifier',
    component: 'classifier',
    baseline: await historicalBundle(baselineRef, classifierFiles, historicalPromptReader),
    current: await args.loader.loadResponseClassifierBundle(),
    counterModel: args.counterModel,
    openAIClient: args.openAIClient,
  }));

  for (const profile of extractorAuditProfiles) {
    comparisons.push(await compareRoute({
      route: `extractor:${profile.name}`,
      component: 'extractor',
      baseline: await historicalBundle(
        baselineRef,
        legacyExtractorFiles,
        historicalPromptReader,
      ),
      current: await args.loader.loadExtractorBundle(profile.capabilities),
      counterModel: args.counterModel,
      openAIClient: args.openAIClient,
    }));
  }

  for (const node of decisionNodes) {
    const baselineNode = node === 'responder_invitacion'
      ? 'resolver_consultas_informativas'
      : node;
    comparisons.push(await compareRoute({
      route: node,
      component: 'reply',
      baseline: await historicalBundle(
        baselineRef,
        [...legacyConversationFiles, ...nodePromptManifest[baselineNode].files],
        historicalPromptReader,
      ),
      current: await args.loader.loadNodeBundle(node),
      counterModel: args.counterModel,
      openAIClient: args.openAIClient,
    }));
  }

  for (const comparison of comparisons) {
    if (comparison.current.duplicateNormalizedParagraphCount > 0) {
      violations.push(
        `${comparison.route}: current prompt contains duplicate normalized paragraphs`,
      );
    }
    if (comparison.component !== 'classifier' &&
      comparison.current.serializedRequestBytes >= comparison.baseline.serializedRequestBytes) {
      violations.push(`${comparison.route}: current serialized prompt did not shrink`);
    }
    if (
      comparison.component === 'classifier' &&
      comparison.current.serializedRequestBytes >
        comparison.baseline.serializedRequestBytes * 1.05
    ) {
      violations.push(`${comparison.route}: classifier prompt grew by more than 5%`);
    }
    if (comparison.remoteInputTokenDelta !== null &&
      comparison.component !== 'classifier' && comparison.remoteInputTokenDelta >= 0) {
      violations.push(`${comparison.route}: current remote input-token count did not shrink`);
    }
  }

  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    baselineRef,
    counterModel: args.counterModel,
    comparisons,
    summary: summarize(comparisons),
    violations,
  };
}

async function compareRoute(args: {
  route: string;
  component: PromptShapeComparison['component'];
  baseline: PromptBundle;
  current: PromptBundle;
  counterModel: string;
  openAIClient?: OpenAI;
}): Promise<PromptShapeComparison> {
  const [baseline, current] = await Promise.all([
    measure(args.baseline, args.route, args.counterModel, args.openAIClient),
    measure(args.current, args.route, args.counterModel, args.openAIClient),
  ]);
  const serializedRequestByteDelta = current.serializedRequestBytes -
    baseline.serializedRequestBytes;
  const remoteInputTokenDelta = baseline.remoteInputTokens === null ||
    current.remoteInputTokens === null
    ? null
    : current.remoteInputTokens - baseline.remoteInputTokens;

  return {
    route: args.route,
    component: args.component,
    baselineFiles: args.baseline.filePaths,
    currentFiles: args.current.filePaths,
    baseline,
    current,
    serializedRequestByteDelta,
    serializedRequestByteReductionPercent: reductionPercent(
      baseline.serializedRequestBytes,
      current.serializedRequestBytes,
    ),
    remoteInputTokenDelta,
    remoteInputTokenReductionPercent: baseline.remoteInputTokens === null ||
      current.remoteInputTokens === null
      ? null
      : reductionPercent(baseline.remoteInputTokens, current.remoteInputTokens),
  };
}

async function measure(
  bundle: PromptBundle,
  route: string,
  counterModel: string,
  openAIClient?: OpenAI,
): Promise<PromptShapeMetrics> {
  const candidate = {
    model: counterModel,
    instructions: bundle.instructions,
    input: `Escenario de auditoría estructural: ${route}`,
    reasoning: { effort: 'none' as const },
    text: { verbosity: 'low' as const },
  };
  const paragraphs = normalizedParagraphs(bundle.instructions);
  const duplicateNormalizedParagraphCount = paragraphs.filter(
    (paragraph, index) => paragraphs.indexOf(paragraph) !== index,
  ).length;

  return {
    fileCount: bundle.filePaths.length,
    instructionBytes: Buffer.byteLength(bundle.instructions, 'utf8'),
    serializedRequestBytes: Buffer.byteLength(JSON.stringify(candidate), 'utf8'),
    normalizedParagraphCount: paragraphs.length,
    duplicateNormalizedParagraphCount,
    remoteInputTokens: openAIClient
      ? (await openAIClient.responses.inputTokens.count(candidate)).input_tokens
      : null,
  };
}

async function historicalBundle(
  baselineRef: string,
  filePaths: readonly string[],
  historicalPromptReader: HistoricalPromptReader,
): Promise<PromptBundle> {
  const contents = await Promise.all(filePaths.map(async (relativePath) => ({
    relativePath,
    content: await historicalPromptReader(baselineRef, relativePath),
  })));
  return {
    id: `git:${baselineRef}`,
    filePaths: [...filePaths],
    ruleIds: [],
    instructions: contents.map(
      ({ relativePath, content }) => `## ${relativePath}\n${content.trim()}`,
    ).join('\n\n'),
    allowedTools: [],
  };
}

async function readHistoricalPrompt(
  baselineRef: string,
  relativePath: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['show', `${baselineRef}:prompts/${relativePath}`],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout;
}

function summarize(comparisons: readonly PromptShapeComparison[]) {
  const baselineSerializedRequestBytes = sum(
    comparisons.map((comparison) => comparison.baseline.serializedRequestBytes),
  );
  const currentSerializedRequestBytes = sum(
    comparisons.map((comparison) => comparison.current.serializedRequestBytes),
  );
  const hasRemoteCounts = comparisons.every(
    (comparison) => comparison.baseline.remoteInputTokens !== null &&
      comparison.current.remoteInputTokens !== null,
  );
  const baselineRemoteInputTokens = hasRemoteCounts
    ? sum(comparisons.map((comparison) => comparison.baseline.remoteInputTokens ?? 0))
    : null;
  const currentRemoteInputTokens = hasRemoteCounts
    ? sum(comparisons.map((comparison) => comparison.current.remoteInputTokens ?? 0))
    : null;
  return {
    baselineSerializedRequestBytes,
    currentSerializedRequestBytes,
    serializedRequestByteReductionPercent: reductionPercent(
      baselineSerializedRequestBytes,
      currentSerializedRequestBytes,
    ),
    baselineRemoteInputTokens,
    currentRemoteInputTokens,
    remoteInputTokenReductionPercent: baselineRemoteInputTokens === null ||
      currentRemoteInputTokens === null
      ? null
      : reductionPercent(baselineRemoteInputTokens, currentRemoteInputTokens),
  };
}

function reductionPercent(baseline: number, current: number): number {
  return Number((((baseline - current) / baseline) * 100).toFixed(2));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
