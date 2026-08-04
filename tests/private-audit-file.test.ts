import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writePrivateAuditFile } from '../src/audit/private-audit-file';

describe('writePrivateAuditFile', () => {
  it('creates an audit directory with mode 0700 and a file with mode 0600', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openai-audit-'));
    const outputDirectory = path.join(tempRoot, '.openai-audits');
    const outputPath = await writePrivateAuditFile(
      { response_id: 'resp_test' },
      {
        outputDirectory,
        capturedAt: new Date('2026-08-04T00:00:00.000Z'),
      },
    );

    const directoryMode = (await fs.stat(outputDirectory)).mode & 0o777;
    const fileMode = (await fs.stat(outputPath)).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
    expect(JSON.parse(await fs.readFile(outputPath, 'utf8'))).toEqual({
      response_id: 'resp_test',
    });
  });
});
