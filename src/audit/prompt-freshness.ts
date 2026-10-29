import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

/** Review invalidation, not an automatic proof that prose is consistent. */
export const promptReviewLockSchema = z.object({
  version: z.literal(1),
  dependencies: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
  prompts: z.array(z.object({
    file: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    status: z.enum(['pending', 'blocked', 'approved']),
    reviewEvidence: z.string(),
    blockingFindings: z.array(z.string()),
  }).strict()),
}).strict();

export type PromptReviewLock = z.infer<typeof promptReviewLockSchema>;

/** Coarse dependency boundary: a change invalidates all reviews deliberately. */
export const promptReviewDependencies = [
  'src/runtime/prompt-manifest.ts',
  'src/runtime/prompt-loader.ts',
  'src/runtime/model-request-projector.ts',
  'src/runtime/openai-agent-runtime.ts',
  'src/runtime/extraction-schemas.ts',
  'src/runtime/extraction-projection.ts',
  'src/runtime/contracts.ts',
  'src/runtime/capability-manifest.ts',
  'src/runtime/decisions-router-questions.ts',
  'src/runtime/decisions-router-input.ts',
  'src/runtime/decisions-router-policy.ts',
  'src/core/information.ts',
  'src/core/messages.ts',
  'src/core/plan.ts',
  'src/core/open-request.ts',
  'src/runtime/agent-service.ts',
  'src/runtime/customer-context.ts',
  'src/runtime/support-outcome.ts',
  'src/runtime/turn-capability-policy.ts',
  'src/runtime/close-flow-schemas.ts',
  'src/runtime/openai-structured-schema.ts',
  'src/runtime/knowledge-retrieval-gateway.ts',
  'src/runtime/commission-grounding.ts',
  'src/runtime/host-withdrawal-policy.ts',
  'knowledge-base/articles/cuanto-cuesta.md',
  'knowledge-base/articles/cuanto-cuesta-invitados.md',
  'knowledge-base/articles/donde-va-el-dinero.md',
  'src/audit/prompt-freshness.ts',
  'src/audit/prompt-contracts.ts',
  'src/audit/prompt-inventory.ts',
] as const;

const digest = (bytes: Uint8Array): string =>
  crypto.createHash('sha256').update(bytes).digest('hex');

async function promptFiles(root: string, relative = 'prompts'): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Prompt symlink requires explicit review: ${file}`);
    if (entry.isDirectory()) files.push(...await promptFiles(root, file));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}

/** Candidates always start pending. Generating a digest cannot approve a review. */
export async function buildPromptReviewCandidate(
  root: string,
  dependencies?: readonly string[],
): Promise<PromptReviewLock> {
  const hashes: Record<string, string> = {};
  const dependencyFiles = dependencies ?? [...new Set([
    ...promptReviewDependencies,
    ...(await promptFiles(root, 'src/runtime')).filter((file) => file.endsWith('.ts')),
    ...(await promptFiles(root, 'src/core')).filter((file) => file.endsWith('.ts')),
    ...(await promptFiles(root, 'knowledge-base')).filter((file) => /\.(?:md|json)$/u.test(file)),
  ])];
  for (const file of [...dependencyFiles].sort()) {
    hashes[file] = digest(await fs.readFile(path.join(root, file)));
  }
  const prompts: PromptReviewLock['prompts'] = [];
  for (const file of await promptFiles(root)) {
    prompts.push({ file, sha256: digest(await fs.readFile(path.join(root, file))),
      status: 'pending', reviewEvidence: '', blockingFindings: [] });
  }
  return { version: 1, dependencies: hashes, prompts };
}

/** Fail closed on edits, new/deleted files, pending review or blocking findings. */
export function comparePromptReview(
  current: PromptReviewLock,
  reviewed: PromptReviewLock,
): string[] {
  const issues: string[] = [];
  for (const file of new Set([...Object.keys(current.dependencies), ...Object.keys(reviewed.dependencies)])) {
    if (current.dependencies[file] !== reviewed.dependencies[file]) {
      issues.push(`Dependency changed; semantic/composition review required: ${file}`);
    }
  }
  const byFile = new Map(reviewed.prompts.map((entry) => [entry.file, entry]));
  if (byFile.size !== reviewed.prompts.length) issues.push('Duplicate prompt review entries');
  const currentFiles = new Set(current.prompts.map((entry) => entry.file));
  for (const entry of reviewed.prompts) {
    if (!currentFiles.has(entry.file)) issues.push(`Reviewed prompt no longer exists: ${entry.file}`);
  }
  for (const entry of current.prompts) {
    const prior = byFile.get(entry.file);
    if (!prior) { issues.push(`Unreviewed prompt: ${entry.file}`); continue; }
    if (prior.sha256 !== entry.sha256) issues.push(`Prompt changed: ${entry.file}`);
    if (prior.status !== 'approved' || prior.reviewEvidence.trim().length === 0 || prior.blockingFindings.length > 0) {
      issues.push(`Prompt review is not approved or has blocking findings: ${entry.file}`);
    }
  }
  return issues;
}
