import fs from 'node:fs/promises';
import path from 'node:path';

export async function writePrivateAuditFile(
  audit: Record<string, unknown>,
  options: {
    outputDirectory?: string;
    capturedAt?: Date;
  } = {},
): Promise<string> {
  const outputDirectory = options.outputDirectory ??
    path.resolve(process.cwd(), '.openai-audits');
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(outputDirectory, 0o700);
  const timestamp = (options.capturedAt ?? new Date())
    .toISOString()
    .replace(/[:.]/gu, '-');
  const outputPath = path.join(outputDirectory, `openai-audit-${timestamp}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await fs.chmod(outputPath, 0o600);
  return outputPath;
}
