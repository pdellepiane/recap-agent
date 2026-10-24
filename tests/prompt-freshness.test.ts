import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildPromptReviewCandidate, comparePromptReview, type PromptReviewLock } from '../src/audit/prompt-freshness';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<{ root: string; reviewed: PromptReviewLock }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-freshness-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'prompts'));
  await fs.writeFile(path.join(root, 'prompts/rule.txt'), 'Current policy');
  await fs.writeFile(path.join(root, 'schema.ts'), 'Current schema');
  const reviewed = await buildPromptReviewCandidate(root, ['schema.ts']);
  reviewed.prompts.forEach((entry) => { entry.status = 'approved'; entry.reviewEvidence = 'Fixture semantic review'; });
  return { root, reviewed };
}

describe('prompt review freshness', () => {
  it('never treats a generated snapshot as approval', async () => {
    const { root } = await fixture();
    const candidate = await buildPromptReviewCandidate(root, ['schema.ts']);
    expect(comparePromptReview(candidate, candidate)).not.toEqual([]);
  });
  it('accepts unchanged reviewed text and invalidates same-length prompt edits', async () => {
    const { root, reviewed } = await fixture();
    expect(comparePromptReview(await buildPromptReviewCandidate(root, ['schema.ts']), reviewed)).toEqual([]);
    await fs.writeFile(path.join(root, 'prompts/rule.txt'), 'Retired policy');
    expect(comparePromptReview(await buildPromptReviewCandidate(root, ['schema.ts']), reviewed)).toContain('Prompt changed: prompts/rule.txt');
  });
  it('invalidates unchanged prompts when the schema/compiler dependency changes', async () => {
    const { root, reviewed } = await fixture();
    await fs.writeFile(path.join(root, 'schema.ts'), 'Changed schema');
    expect(comparePromptReview(await buildPromptReviewCandidate(root, ['schema.ts']), reviewed)).toContain('Dependency changed; semantic/composition review required: schema.ts');
  });
  it('detects new and removed files rather than accepting stale inventory', async () => {
    const { root, reviewed } = await fixture();
    await fs.unlink(path.join(root, 'prompts/rule.txt'));
    await fs.writeFile(path.join(root, 'prompts/new.txt'), 'New policy');
    const issues = comparePromptReview(await buildPromptReviewCandidate(root, ['schema.ts']), reviewed);
    expect(issues).toContain('Unreviewed prompt: prompts/new.txt');
    expect(issues).toContain('Reviewed prompt no longer exists: prompts/rule.txt');
  });
  it('rejects unresolved findings even if someone sets the status to approved', async () => {
    const { root, reviewed } = await fixture();
    const entry = reviewed.prompts[0];
    if (!entry) throw new Error('Missing fixture prompt');
    entry.blockingFindings.push('Conflicting responsibility');
    expect(comparePromptReview(await buildPromptReviewCandidate(root, ['schema.ts']), reviewed)).not.toEqual([]);
  });
});
