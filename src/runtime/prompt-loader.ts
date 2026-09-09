import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { DecisionNode } from '../core/decision-nodes';
import {
  conversationPromptFilesForNode,
  extractorPromptFiles,
  extractorPromptFilesForCapabilities,
  nodePromptManifest,
  promptRuleIdForFile,
  responseClassifierPromptFiles,
  type ToolName,
} from './prompt-manifest';
import type { ExtractionCapabilityProfile } from './extraction-schemas';
import type { InformationAuthReason } from '../core/information';
import { hostWithdrawalMessagesSchema } from './host-withdrawal-policy';
import {
  parseCapabilityBoundaryMessages,
  type CapabilityBoundaryMessages,
} from './capability-boundary-renderer';

export type PromptLoadContext = {
  informationAuthReasons?: readonly InformationAuthReason[];
};

export type ResponseClassifierPromptProfile = keyof typeof responseClassifierPromptFiles;

export type PromptBundle = {
  id: string;
  filePaths: string[];
  ruleIds: string[];
  instructions: string;
  allowedTools: readonly ToolName[];
};

/**
 * S10 bundle measurement recorded once per bundle identity.
 *
 * Captures the actual instruction/input bytes plus the structural
 * schema/tool counts that feed the model call, so unaffected outcomes
 * prove no byte growth and changed requests report their deltas.
 */
export type BundleMeasurement = {
  bundleId: string;
  instructionBytes: number;
  inputBytes: number;
  schemaPropertyCount: number;
  toolCount: number;
  serializedBytes: number;
};

export type BundleDelta = {
  instructionDelta: number;
  inputDelta: number;
  schemaDelta: number;
  toolDelta: number;
  serializedDelta: number;
  grew: boolean;
};

export function measureBundle(args: {
  bundleId: string;
  instructions: string;
  input: string;
  schemaPropertyCount: number;
  toolCount: number;
}): BundleMeasurement {
  const instructionBytes = Buffer.byteLength(args.instructions, 'utf8');
  const inputBytes = Buffer.byteLength(args.input, 'utf8');
  const serializedBytes = Buffer.byteLength(
    JSON.stringify({
      bundleId: args.bundleId,
      instructions: args.instructions,
      input: args.input,
      schemaPropertyCount: args.schemaPropertyCount,
      toolCount: args.toolCount,
    }),
    'utf8',
  );
  return {
    bundleId: args.bundleId,
    instructionBytes,
    inputBytes,
    schemaPropertyCount: args.schemaPropertyCount,
    toolCount: args.toolCount,
    serializedBytes,
  };
}

export function summarizeBundleDelta(
  before: BundleMeasurement,
  after: BundleMeasurement,
): BundleDelta {
  const instructionDelta = after.instructionBytes - before.instructionBytes;
  const inputDelta = after.inputBytes - before.inputBytes;
  const schemaDelta = after.schemaPropertyCount - before.schemaPropertyCount;
  const toolDelta = after.toolCount - before.toolCount;
  const serializedDelta = after.serializedBytes - before.serializedBytes;
  return {
    instructionDelta,
    inputDelta,
    schemaDelta,
    toolDelta,
    serializedDelta,
    grew: instructionDelta > 0 || inputDelta > 0 || schemaDelta > 0 ||
      toolDelta > 0 || serializedDelta > 0,
  };
}

export class PromptLoader {
  constructor(private readonly promptsDir: string) {}

  async loadImageBundle(): Promise<PromptBundle> {
    return this.load(['nodes/resolver_consultas_informativas/image_inspection.txt'], []);
  }

  async loadImageMessages(): Promise<Record<'image_too_large' | 'media_unavailable' | 'handoff_requested' | 'handoff_failed', string>> {
    const { z } = await import('zod');
    const schema = z.object({ image_too_large: z.string(), media_unavailable: z.string(),
      handoff_requested: z.string(), handoff_failed: z.string() }).strict();
    return schema.parse(JSON.parse(await fs.readFile(path.join(this.promptsDir,
      'nodes/resolver_consultas_informativas/image_outcomes.json'), 'utf8')) as unknown);
  }

  async loadHostWithdrawalMessages() {
    const content = await fs.readFile(path.join(this.promptsDir,
      'nodes/resolver_consultas_informativas/host-withdrawal.json'), 'utf8');
    return hostWithdrawalMessagesSchema.parse(JSON.parse(content) as unknown);
  }

  async loadCapabilityBoundaryMessages(): Promise<CapabilityBoundaryMessages> {
    const content = await fs.readFile(path.join(
      this.promptsDir,
      'nodes/resolver_consultas_informativas/capability_boundary.txt',
    ), 'utf8');
    return parseCapabilityBoundaryMessages(content);
  }

  async loadNodeBundle(
    node: DecisionNode,
    context: PromptLoadContext = {},
  ): Promise<PromptBundle> {
    const config = nodePromptManifest[node];
    const relativePaths = [...conversationPromptFilesForNode(node), ...config.files];
    return this.load(relativePaths, config.allowedTools, context);
  }

  async loadExtractorBundle(
    capabilities?: ExtractionCapabilityProfile,
  ): Promise<PromptBundle> {
    const relativePaths = capabilities
      ? extractorPromptFilesForCapabilities(capabilities)
      : extractorPromptFiles;
    return this.load([...relativePaths], []);
  }

  async loadResponseClassifierBundle(
    profile: ResponseClassifierPromptProfile = 'general',
  ): Promise<PromptBundle> {
    return this.load(responseClassifierPromptFiles[profile], []);
  }

  private async load(
    relativePaths: readonly string[],
    allowedTools: readonly ToolName[],
    context: PromptLoadContext = {},
  ): Promise<PromptBundle> {
    const contents = await Promise.all(
      relativePaths.map(async (relativePath) => {
        const absolutePath = path.join(this.promptsDir, relativePath);
        const rawContent = await fs.readFile(absolutePath, 'utf8');
        return {
          relativePath,
          content: this.projectMinimumDisclosure(rawContent, context),
        };
      }),
    );

    const instructions = contents
      .map(({ relativePath, content }) => `## ${this.displayPath(relativePath)}\n${content.trim()}`)
      .join('\n\n');

    const id = crypto
      .createHash('sha256')
      .update(
        contents
          .map(({ relativePath, content }) => `${relativePath}:${content}`)
          .join('\n---\n'),
      )
      .digest('hex')
      .slice(0, 12);

    return {
      id,
      filePaths: contents.map(({ relativePath }) => relativePath),
      ruleIds: contents.map(({ relativePath }) => promptRuleIdForFile(relativePath)),
      instructions,
      allowedTools,
    };
  }

  private projectMinimumDisclosure(
    content: string,
    context: PromptLoadContext,
  ): string {
    const selected = new Set(context.informationAuthReasons ?? []);
    return content.replace(
      /<!--\s*min-disclosure:\s*([^>]+?)\s*-->([\s\S]*?)<!--\s*\/min-disclosure\s*-->/gu,
      (_match, labels: string, section: string) => {
        const sectionLabels = labels.trim().split(/[\s,]+/u).filter(Boolean);
        return sectionLabels.some((label) => selected.has(label as InformationAuthReason))
          ? section.trim()
          : '';
      },
    );
  }

  private displayPath(relativePath: string): string {
    return relativePath;
  }
}
