import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceFiles = [
  'src/runtime/agent-service.ts',
  'src/runtime/openai-agent-runtime.ts',
  'src/core/decision-flow.ts',
  'src/core/decision-nodes.ts',
];

describe('ATC templates do not add exact-string conversational routing', () => {
  it('keeps trigger handling out of runtime flow decision modules', () => {
    const runtimeSource = sourceFiles
      .map((filePath) => fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf-8'))
      .join('\n');

    expect(runtimeSource).not.toContain('atc-templates');
    expect(runtimeSource).not.toContain('customer_service_template');
    expect(runtimeSource).not.toContain('Triggers:');
  });
});
