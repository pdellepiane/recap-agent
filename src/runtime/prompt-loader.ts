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
  /**
   * O4 per-process raw file cache. Keys are absolute prompt paths; values
   * carry the observed stat signature so an edited file is re-read while an
   * immutable file never hits disk twice. Only immutable prompt bytes are
   * cached here: projected bundles stay keyed by their full disclosure
   * context and customer-bearing requests are never memoized.
   */
  private readonly rawContentCache = new Map<string, { mtimeMs: number; size: number; content: string }>();

  constructor(private readonly promptsDir: string) {}

  /** Test-only view of cached absolute paths; never customer content. */
  cachedRawFileCountForTest(): number {
    return this.rawContentCache.size;
  }

  async loadAuthControlBundle(): Promise<PromptBundle> {
    return this.load(['nodes/resolver_consultas_informativas/auth_control.txt'], []);
  }

  async loadImageBundle(): Promise<PromptBundle> {
    return this.load(['nodes/resolver_consultas_informativas/image_inspection.txt'], []);
  }

  async loadSupportContinuityBundle(): Promise<PromptBundle> {
    return this.load(['nodes/resolver_consultas_informativas/support_continuity.txt'], []);
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
    options: { includeImageReference?: boolean } = {},
  ): Promise<PromptBundle> {
    const relativePaths = capabilities
      ? extractorPromptFilesForCapabilities(capabilities)
      : extractorPromptFiles;
    // Minimum disclosure: follow-up image-linkage guidance travels only
    // while the plan stores image attachments. Imageless turns and static
    // audit bundles stay byte-identical.
    const imageReferencePaths = options.includeImageReference === true
      ? ['extractors/image_reference.txt' as const]
      : [];
    return this.load([...relativePaths, ...imageReferencePaths], []);
  }

  async loadResponseClassifierBundle(
    profile: ResponseClassifierPromptProfile = 'general',
  ): Promise<PromptBundle> {
    return this.load(responseClassifierPromptFiles[profile], []);
  }

  /**
   * G1/G3 compiler bundle: loads exactly the tracked files selected by
   * model-request-projector for the request actually sent, plus per-file
   * byte sizes for the local relevance manifest. Load/cache only: module
   * selection lives in the projector, never here.
   */
  async loadModuleFilesBundle(
    relativePaths: readonly string[],
    allowedTools: readonly ToolName[],
  ): Promise<PromptBundle & { fileBytes: readonly number[] }> {
    const contents = await Promise.all(
      relativePaths.map(async (relativePath) => {
        const absolutePath = path.join(this.promptsDir, relativePath);
        const rawContent = await this.readRawPromptFile(absolutePath);
        return {
          relativePath,
          content: rawContent,
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
      fileBytes: contents.map(({ content }) => Buffer.byteLength(content, 'utf8')),
    };
  }

  private async load(
    relativePaths: readonly string[],
    allowedTools: readonly ToolName[],
    context: PromptLoadContext = {},
  ): Promise<PromptBundle> {
    const contents = await Promise.all(
      relativePaths.map(async (relativePath) => {
        const absolutePath = path.join(this.promptsDir, relativePath);
        const rawContent = await this.readRawPromptFile(absolutePath);
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

  private async readRawPromptFile(absolutePath: string): Promise<string> {
    const stat = await fs.stat(absolutePath);
    const cached = this.rawContentCache.get(absolutePath);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.content;
    }
    const content = await fs.readFile(absolutePath, 'utf8');
    this.rawContentCache.set(absolutePath, { mtimeMs: stat.mtimeMs, size: stat.size, content });
    return content;
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
