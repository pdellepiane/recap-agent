import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { DecisionNode } from '../core/decision-nodes';
import { extractorPromptFiles, nodePromptManifest, sharedPromptFiles } from './prompt-manifest';

export type PromptBundle = {
  id: string;
  filePaths: string[];
  instructions: string;
};

export class PromptLoader {
  constructor(private readonly promptsDir: string) {}

  async loadNodeBundle(node: DecisionNode): Promise<PromptBundle> {
    const relativePaths = [...sharedPromptFiles, ...nodePromptManifest[node]];
    return this.load(relativePaths);
  }

  async loadExtractorBundle(): Promise<PromptBundle> {
    return this.load([...sharedPromptFiles, ...extractorPromptFiles]);
  }

  private async load(relativePaths: readonly string[]): Promise<PromptBundle> {
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
      .map(({ relativePath, content }) => `## ${relativePath}\n${content.trim()}`)
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
      instructions,
    };
  }
}

