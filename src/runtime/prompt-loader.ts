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

export class PromptLoader {
  constructor(private readonly promptsDir: string) {}

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
