import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { EvalLoader } from '../src/evals/loader';

describe('EvalLoader', () => {
  it('applies template merging and variable interpolation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-loader-'));
    await fs.mkdir(path.join(tempDir, 'templates'));
    await fs.mkdir(path.join(tempDir, 'cases'));
    await fs.mkdir(path.join(tempDir, 'suites'));

    await fs.writeFile(
      path.join(tempDir, 'templates', 'base.yaml'),
      [
        'id: template.base',
        'suite: template',
        'version: 1',
        'description: Base case',
        'targetModes: [offline]',
        'inputs:',
        '  - text: hello',
        'expectations: []',
        'scorers: []',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(tempDir, 'cases', 'case.yaml'),
      [
        'template: template.base',
        'id: greeting.case',
        'suite: smoke',
        'version: 1',
        'description: Greeting for {{event_type}} in {{location}}',
        'variables:',
        '  event_type: boda',
        '  location: Lima',
        'inputs:',
        '  - text: quiero planear una {{event_type}} en {{location}}',
        'expectations: []',
        'scorers: []',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(tempDir, 'suites', 'smoke.yaml'),
      ['id: smoke', 'description: Smoke suite', 'caseIds:', '  - greeting.case'].join('\n'),
      'utf8',
    );

    const loader = new EvalLoader(tempDir);
    const catalog = await loader.loadCatalog();
    expect(catalog.cases).toHaveLength(1);
    expect(catalog.cases[0]?.description).toBe('Greeting for boda in Lima');
    expect(catalog.cases[0]?.inputs[0]?.text).toBe('quiero planear una boda en Lima');
  });

  it('supports reusable imported fixture fragments', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-loader-imports-'));
    await fs.mkdir(path.join(tempDir, 'templates'));
    await fs.mkdir(path.join(tempDir, 'cases'));
    await fs.mkdir(path.join(tempDir, 'suites'));
    await fs.mkdir(path.join(tempDir, 'fixtures'));

    await fs.writeFile(
      path.join(tempDir, 'templates', 'base.yaml'),
      [
        'id: template.base',
        'suite: template',
        'version: 1',
        'description: Base case',
        'targetModes: [offline]',
        'inputs:',
        '  - text: hello',
        'expectations: []',
        'scorers: []',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(tempDir, 'fixtures', 'seed.yaml'),
      [
        'seedPlan:',
        '  event_type: boda',
        '  location: Lima',
        'fixtures:',
        '  offline:',
        '    repliesByTurn:',
        '      - respuesta importada',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(tempDir, 'cases', 'case.yaml'),
      [
        'template: template.base',
        'imports:',
        '  - ../fixtures/seed.yaml',
        'id: imported.case',
        'suite: smoke',
        'version: 1',
        'description: Imported case',
        'inputs:',
        '  - text: hola',
        'expectations: []',
        'scorers: []',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(tempDir, 'suites', 'smoke.yaml'),
      ['id: smoke', 'description: Smoke suite', 'caseIds:', '  - imported.case'].join('\n'),
      'utf8',
    );

    const loader = new EvalLoader(tempDir);
    const catalog = await loader.loadCatalog();
    expect(catalog.cases[0]?.seedPlan?.event_type).toBe('boda');
    expect(catalog.cases[0]?.fixtures?.offline?.repliesByTurn?.[0]).toBe('respuesta importada');
  });

  it('rejects malformed case files through schema validation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-loader-invalid-'));
    await fs.mkdir(path.join(tempDir, 'cases'));

    await fs.writeFile(
      path.join(tempDir, 'cases', 'broken.yaml'),
      ['id: broken.case', 'description: Missing required suite and inputs'].join('\n'),
      'utf8',
    );

    const loader = new EvalLoader(tempDir);
    await expect(loader.loadCatalog()).rejects.toThrow();
  });
});
