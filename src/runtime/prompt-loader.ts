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
  type ToolName,
} from './prompt-manifest';
import type { ExtractionCapabilityProfile } from './extraction-schemas';

export type PromptBundle = {
  id: string;
  filePaths: string[];
  ruleIds: string[];
  instructions: string;
  allowedTools: readonly ToolName[];
};

export class PromptLoader {
  constructor(private readonly promptsDir: string) {}

  async loadNodeBundle(node: DecisionNode): Promise<PromptBundle> {
    const config = nodePromptManifest[node];
    const relativePaths = [...conversationPromptFilesForNode(node), ...config.files];
    return this.load(relativePaths, config.allowedTools);
  }

  async loadExtractorBundle(
    capabilities?: ExtractionCapabilityProfile,
  ): Promise<PromptBundle> {
    const relativePaths = capabilities
      ? extractorPromptFilesForCapabilities(capabilities)
      : extractorPromptFiles;
    return this.load([...relativePaths], []);
  }

  async loadResponseClassifierBundle(): Promise<PromptBundle> {
    return this.load(['nodes/deteccion_intencion/response_classifier.txt'], []);
  }

  private async load(
    relativePaths: readonly string[],
    allowedTools: readonly ToolName[],
  ): Promise<PromptBundle> {
    const contents = await Promise.all(
      relativePaths.map(async (relativePath) => {
        const absolutePath = path.join(this.promptsDir, relativePath);
        return {
          relativePath,
          content: await fs.readFile(absolutePath, 'utf8'),
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

  private displayPath(relativePath: string): string {
    return relativePath;
  }
}
