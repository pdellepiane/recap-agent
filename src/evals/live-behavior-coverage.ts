import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

/** Uncommitted implementation provenance must never masquerade as a commit. */
export const liveBehaviorCoverageSchema = z.object({
  version: z.literal(1),
  behaviorChanges: z.array(z.object({
    id: z.string().min(1),
    implementedBy: z.union([z.string().regex(/^[0-9a-f]{7,40}$/u), z.literal('working-tree')]),
    implementationEvidence: z.array(z.string().min(1)).optional(),
    liveCaseIds: z.array(z.string().min(1)).min(1),
    status: z.enum(['active', 'retired']).default('active'),
    retirementReason: z.string().min(1).optional(),
  }).superRefine((entry, context) => {
    if (entry.implementedBy === 'working-tree' && !entry.implementationEvidence?.length) {
      context.addIssue({ code: 'custom', path: ['implementationEvidence'], message: 'Working-tree changes require explicit source evidence' });
    }
  })).min(1),
});

export type LiveBehaviorCoverage = z.infer<typeof liveBehaviorCoverageSchema>;

/** Check referenced source files without treating their presence as review approval. */
export async function validateCoverageImplementationEvidence(
  registry: LiveBehaviorCoverage,
  root: string,
): Promise<string[]> {
  const issues: string[] = [];
  for (const change of registry.behaviorChanges) {
    if (change.implementedBy !== 'working-tree') continue;
    for (const file of change.implementationEvidence ?? []) {
      const absolute = path.resolve(root, file);
      if (path.isAbsolute(file) || path.relative(root, absolute).startsWith('..')) {
        issues.push(`${change.id}: source evidence must remain inside the repository: ${file}`);
        continue;
      }
      try {
        if (!(await fs.stat(absolute)).isFile()) issues.push(`${change.id}: evidence is not a file: ${file}`);
      } catch {
        issues.push(`${change.id}: source evidence does not exist: ${file}`);
      }
    }
  }
  return issues;
}
