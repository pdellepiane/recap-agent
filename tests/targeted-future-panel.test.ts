import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const panelSchema = z.object({
  status: z.string(), paidBudgetUsd: z.number().positive().nullable(),
  maxExecutionsPerCase: z.literal(1), semanticJudgeCalls: z.literal(0),
  allowSemanticRetry: z.literal(false), allowPanelExpansion: z.literal(false),
  cases: z.array(z.object({ id: z.string(), file: z.string(), sha256: z.string(), maxTurns: z.number().int().positive() })),
  maxScriptedTurns: z.number().int().positive(),
  fixtures: z.array(z.object({ scenario: z.string(), file: z.string(), sha256: z.string() })),
});

describe('frozen targeted future panel', () => {
  it('pins exact case sources and finite turns before development execution', async () => {
    const panel = panelSchema.parse(JSON.parse(await fs.readFile('docs/plan/2026-10-23-consolidated-supervisor-audit/targeted-future-panel.json', 'utf8')) as unknown);
    expect(new Set(panel.cases.map((entry) => entry.id)).size).toBe(panel.cases.length);
    if (panel.paidBudgetUsd === null) expect(panel.status).toContain('blocked');
    let turns = 0;
    for (const entry of panel.cases) {
      const bytes = await fs.readFile(entry.file);
      expect(crypto.createHash('sha256').update(bytes).digest('hex'), entry.id).toBe(entry.sha256);
      const current = z.object({ id: z.string(), inputs: z.array(z.unknown()) }).parse(YAML.parse(bytes.toString()) as unknown);
      expect(current.id).toBe(entry.id);
      expect(current.inputs).toHaveLength(entry.maxTurns);
      turns += entry.maxTurns;
    }
    expect(turns).toBe(panel.maxScriptedTurns);
    for (const fixture of panel.fixtures) {
      const bytes = await fs.readFile(fixture.file);
      expect(crypto.createHash('sha256').update(bytes).digest('hex'), fixture.scenario).toBe(fixture.sha256);
    }
  });
});
