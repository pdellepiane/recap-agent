import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

function workflow(name: string): Record<string, unknown> {
  const text = fs.readFileSync(
    path.resolve(process.cwd(), '.github', 'workflows', name),
    'utf8',
  );
  const parsed = YAML.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must parse as a workflow mapping`);
  }
  return parsed as Record<string, unknown>;
}

describe('GitHub branch deployment workflows', () => {
  it('requires explicit CI dispatch or an explicitly started calling workflow', () => {
    const ci = workflow('ci.yml');
    const triggers = ci['on'] as Record<string, unknown>;
    expect(triggers).toHaveProperty('workflow_call');
    expect(triggers).toHaveProperty('workflow_dispatch');
    expect(Object.keys(triggers).sort()).toEqual(['workflow_call', 'workflow_dispatch']);
    const jobs = ci['jobs'] as { ci: { steps: { name?: string; with?: Record<string, unknown> }[] } };
    expect(jobs.ci.steps.find((step) => step.name === 'Checkout')?.with?.['fetch-depth']).toBe(0);
    expect(JSON.stringify(ci)).not.toContain('continue-on-error');
  });

  it('deploys development only on explicit dispatch from develop with a ZIP-file digest', () => {
    const text = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/deploy-development.yml'),
      'utf8',
    );
    const deploy = workflow('deploy-development.yml');
    const triggers = deploy['on'] as Record<string, unknown>;
    expect(triggers).toHaveProperty('workflow_dispatch');
    expect(Object.keys(triggers)).toEqual(['workflow_dispatch']);
    expect(text).toContain('refs/heads/develop');
    expect(text).toContain('sha256sum .artifacts/deployment/lambda.zip');
    expect(text).toContain('DEPLOY_ARTIFACT_SHA256');
    expect(text).toContain('allowed-account-ids');
  });

  it('keeps production manual, main-only, and rebuild-free', () => {
    const text = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/promote-production.yml'),
      'utf8',
    );
    const promote = workflow('promote-production.yml');
    const triggers = promote['on'] as Record<string, unknown>;
    expect(Object.keys(triggers)).toEqual(['workflow_dispatch']);
    expect(text).toContain('refs/heads/main');
    expect(text).toContain('unzip -t');
    expect(text).toContain('DEPLOY_ARTIFACT_SHA256');
    expect(text).not.toContain('npm run build');
    expect(text).not.toContain('aws s3 cp "${artifact_path}"');
  });

  it('defines separate environment-scoped AWS roles', () => {
    const template = fs.readFileSync(
      path.resolve(process.cwd(), 'infra/cloudformation/github-actions-deployment.yaml'),
      'utf8',
    );
    expect(template).toContain('repo:${Repository}:environment:development');
    expect(template).toContain('repo:${Repository}:environment:production');
    expect(template).toContain('recap-agent-github-development');
    expect(template).toContain('recap-agent-github-production');
    expect(template).toContain('iam:PassedToService: cloudformation.amazonaws.com');
  });
});
