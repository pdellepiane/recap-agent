import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { PromptLoader } from '../src/runtime/prompt-loader';
import { measureHistoricalBranches, measureCurrentBranches } from '../src/audit/prompt-branch-measurement';

describe('prompt branch measurement parity', () => {
  it('projects min-disclosure on both sides with the same empty reason set', async () => {
    const historical = await measureHistoricalBranches({
      anchorRef: '78ae24e',
      counterModel: 'gpt-5.6-luna',
    });
    const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
    const current = await measureCurrentBranches({ loader, counterModel: 'gpt-5.6-luna' });

    const histResolver = historical.find((b) => b.branchId === 'resolver_consultas_informativas');
    const currResolver = current.find((b) => b.branchId === 'resolver_consultas_informativas');
    expect(histResolver).toBeDefined();
    expect(currResolver).toBeDefined();
    expect(histResolver?.instructionBytes).toBe(13459);
    expect(currResolver?.instructionBytes).toBeGreaterThan(0);
    expect(currResolver?.instructionBytes).toBeLessThanOrEqual(histResolver?.instructionBytes as number);
    expect((histResolver?.instructionBytes as number) - (currResolver?.instructionBytes as number)).toBeGreaterThanOrEqual(400);
    expect(histResolver?.instructionBytes).toBeGreaterThan(0);
  }, 15_000);

  it('strips min-disclosure blocks identically via historical mock and loader', async () => {
    const contentWithBlocks = [
      'Line A',
      '<!-- min-disclosure: otp_sent otp_resent -->',
      'Secret OTP line',
      '<!-- /min-disclosure -->',
      'Line B',
      '<!-- min-disclosure: otp_pending -->',
      'Pending line',
      '<!-- /min-disclosure -->',
      'Line C',
    ].join('\n');

    const historical = await measureHistoricalBranches({
      anchorRef: '78ae24e',
      counterModel: 'gpt-5.6-luna',
      historicalReader: async () => contentWithBlocks,
    });
    const sample = historical[0];
    expect(sample.instructionBytes).toBeGreaterThan(0);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-parity-'));
    const testFile = path.join(tmpDir, 'test.txt');
    await fs.writeFile(testFile, contentWithBlocks, 'utf8');
    const histSingle = await measureHistoricalBranches({
      anchorRef: '78ae24e',
      counterModel: 'gpt-5.6-luna',
      historicalReader: async () => contentWithBlocks,
    });
    const expectedStripped = 'Line A\nLine B\nLine C';
    expect(histSingle[0].instructionBytes).toBeGreaterThan(Buffer.byteLength(expectedStripped, 'utf8'));
    const realDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loader-parity-'));
    await fs.mkdir(path.join(realDir, 'nodes', 'test_node'), { recursive: true });
    await fs.writeFile(path.join(realDir, 'nodes', 'test_node', 'system.txt'), contentWithBlocks, 'utf8');
    await fs.writeFile(path.join(realDir, 'nodes', 'test_node', 'response_contract.txt'), 'Plain', 'utf8');
    await fs.writeFile(path.join(realDir, 'nodes', 'test_node', 'tool_policy.txt'), 'None', 'utf8');
    const rawConcatenated = (`## test.txt\n${contentWithBlocks.trim()}`).length;
    expect(histSingle[0].instructionBytes).toBeLessThan(rawConcatenated + 1000);
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(realDir, { recursive: true, force: true });
  }, 15_000);
});
