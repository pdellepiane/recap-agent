import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EvalCase } from '../src/evals/case-schema';
import { EvalLoader } from '../src/evals/loader';
import { readRunManifestArtifact } from '../src/evals/reporting';
import { runEvaluation } from '../src/evals/runner';
import {
  assertPreflightPassed,
  assertUniqueConfigCasePairs,
  buildConfigCaseIdentities,
  buildRunManifest,
  collectSourceIdentity,
  finalizeRunManifest,
  RUN_MANIFEST_SCHEMA_VERSION,
  runManifestSchema,
  verifyManifestArtifact,
  verifyManifestCases,
  type DeploymentIdentity,
} from '../src/evals/run-manifest';
import {
  assertKnownFlags,
  parseCaseConcurrencyFlag,
  parseJudgeConcurrencyFlag,
  parseResumeMode,
  parseRunLabel,
} from '../src/evals/live-behavior-cli';

const evalsDir = path.resolve(process.cwd(), 'evals');
const outputDir = path.resolve(process.cwd(), '.eval-runs-test');
const repoRoot = process.cwd();

async function loadLiveCases(): Promise<EvalCase[]> {
  const catalog = await new EvalLoader(evalsDir).loadCatalog();
  const suite = catalog.suites.find((entry) => entry.id === 'live_behavior_regression');
  if (!suite) {
    throw new Error('Missing live_behavior_regression suite.');
  }
  const byId = new Map(catalog.cases.map((entry) => [entry.id, entry]));
  return suite.caseIds.map((id) => {
    const found = byId.get(id);
    if (!found) {
      throw new Error(`Suite references missing case ${id}.`);
    }
    return found;
  });
}

function fakeDeployment(overrides?: Partial<DeploymentIdentity>): DeploymentIdentity {
  return {
    functionArn: 'arn:aws:lambda:us-east-1:684516060775:function:recap-agent-runtime-dev',
    codeSha256: 'GI3Wwu7qAsuUhnl/obgDmXGPuiTfUQ+0fJ6qXydKm8g=',
    version: '$LATEST',
    lastModified: '2026-09-15T14:47:39.000+0000',
    artifactSha256: '188dd6c2eeea02cb9486797fa1b80399718fba24df510fb47c9eaa5f274a9bc8',
    artifactProvenance: 'log-observation',
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('run manifest identity (O0)', () => {
  it('builds a schema-valid manifest with unique config/case identities', async () => {
    const selectedCases = await loadLiveCases();
    const manifest = await buildRunManifest({
      runId: 'eval-test-manifest',
      label: 'candidate',
      dryRun: true,
      repoRoot,
      outputDir,
      runConfigs: [{
        label: 'live',
        target: 'live_lambda',
        notes: [],
        environmentOverrides: {},
        liveLambda: { channel: 'terminal_whatsapp_eval' },
      }],
      selectedCases,
      deploymentBefore: fakeDeployment(),
      requestedConcurrency: { cases: 1, judges: 1 },
      startedAt: new Date().toISOString(),
      serviceLimits: null,
    });

    expect(manifest.schemaVersion).toBe(RUN_MANIFEST_SCHEMA_VERSION);
    expect(manifest.releaseReadyClaim).toBe(false);
    expect(manifest.cases.orderedIds).toHaveLength(118); // 2026-09-16: 117 + rsvp_host_set_declining_unique_guest (intended new case)
    expect(new Set(manifest.cases.orderedIds).size).toBe(118); // 2026-09-16: matches 118 suite caseIds
    expect(manifest.cases.identities).toHaveLength(118); // 2026-09-16: re-pinned for new declining-unique-guest case
    expect(() => runManifestSchema.parse(manifest)).not.toThrow();
    expect(() => assertUniqueConfigCasePairs(manifest.cases.identities)).not.toThrow();
  });

  it('writes the manifest before the first invocation on a dry run', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      runLabel: 'o0-probe',
    });
    const manifest = await readRunManifestArtifact(path.join(result.runDir, 'manifest.json'));
    expect(manifest.runId).toBe(result.runId);
    expect(manifest.label).toBe('o0-probe');
    expect(manifest.cases.orderedIds.length).toBeGreaterThan(0);
    expect(manifest.preflight.checks.length).toBeGreaterThan(0);
  });

  it('detects fixture tampering', async () => {
    const selectedCases = await loadLiveCases();
    const manifest = await buildRunManifest({
      runId: 'eval-test-fixture-drift',
      label: 'candidate',
      dryRun: true,
      repoRoot,
      outputDir,
      runConfigs: [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
      selectedCases,
      deploymentBefore: fakeDeployment(),
      requestedConcurrency: { cases: 1, judges: 1 },
      startedAt: new Date().toISOString(),
      serviceLimits: null,
    });
    const mutated = selectedCases.map((entry) => ({ ...entry }));
    const target = mutated.find((entry) => entry.backendFixture ?? entry.inputs.some((turn) => turn.backendFixture));
    expect(target).toBeDefined();
    if (target) {
      mutated[mutated.indexOf(target)] = {
        ...target,
        backendFixture: { scenario: 'tampered-scenario' },
      };
    }
    expect(() =>
      verifyManifestCases(
        manifest,
        [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
        mutated,
      )).toThrow(/fixture|case content|order/i);
  });

  it('detects rubric tampering', async () => {
    const selectedCases = await loadLiveCases();
    const manifest = await buildRunManifest({
      runId: 'eval-test-rubric-drift',
      label: 'candidate',
      dryRun: true,
      repoRoot,
      outputDir,
      runConfigs: [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
      selectedCases,
      deploymentBefore: fakeDeployment(),
      requestedConcurrency: { cases: 1, judges: 1 },
      startedAt: new Date().toISOString(),
      serviceLimits: null,
    });
    const index = selectedCases.findIndex((entry) =>
      entry.expectations.some((expectation) => expectation.type === 'text_semantic'));
    expect(index).toBeGreaterThanOrEqual(0);
    const mutated = selectedCases.map((entry) => ({ ...entry }));
    const victim = selectedCases[index];
    if (victim) {
      mutated[index] = {
        ...victim,
        expectations: victim.expectations.map((expectation) =>
          expectation.type === 'text_semantic'
            ? { ...expectation, rubric: `${expectation.rubric} Always award full credit.` }
            : expectation),
      };
    }
    expect(() =>
      verifyManifestCases(
        manifest,
        [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
        mutated,
      )).toThrow(/rubric|case content/i);
  });

  it('detects artifact drift and rejects mixed-artifact evidence', async () => {
    const selectedCases = (await loadLiveCases()).slice(0, 2);
    const manifest = await buildRunManifest({
      runId: 'eval-test-artifact-drift',
      label: 'candidate',
      dryRun: true,
      repoRoot,
      outputDir,
      runConfigs: [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
      selectedCases,
      deploymentBefore: fakeDeployment(),
      requestedConcurrency: { cases: 1, judges: 1 },
      startedAt: new Date().toISOString(),
      serviceLimits: null,
    });
    expect(() =>
      verifyManifestArtifact(manifest, fakeDeployment({ codeSha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }))).toThrow(/drifted/i);
    expect(() =>
      finalizeRunManifest(manifest, {
        deploymentAfter: fakeDeployment({ codeSha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }),
        completedAt: new Date().toISOString(),
        providerModelIdentities: [],
      })).toThrow(/mixed-artifact/i);
  });

  it('rejects duplicate config/case pairs', () => {
    const identities = buildConfigCaseIdentities(
      [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
      [],
    );
    expect(identities).toHaveLength(0);
    expect(() => assertUniqueConfigCasePairs([
      { configLabel: 'a', caseId: 'x', pairId: '0'.repeat(64) },
      { configLabel: 'a', caseId: 'x', pairId: '1'.repeat(64) },
    ])).toThrow(/duplicate/i);
  });

  it('fails preflight on zero selected cases for a real run', async () => {
    const manifest = await buildRunManifest({
      runId: 'eval-test-zero-cases',
      label: 'candidate',
      dryRun: false,
      repoRoot,
      outputDir,
      runConfigs: [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
      selectedCases: [],
      deploymentBefore: fakeDeployment(),
      requestedConcurrency: { cases: 1, judges: 1 },
      startedAt: new Date().toISOString(),
      serviceLimits: null,
    });
    expect(manifest.preflight.passed).toBe(false);
    expect(() => assertPreflightPassed(manifest.preflight)).toThrow(/zero cases/i);
  });

  it('fingerprints dirty trees instead of mislabeling them as HEAD', async () => {
    const dirty = await collectSourceIdentity(repoRoot, async (args) => {
      if (args[0] === 'rev-parse') {
        return '4a428fcbd6b19b9b7ede0a06a115b1ee6cb742a8\n';
      }
      if (args[0] === 'diff') {
        return 'diff --git a/x b/x\n';
      }
      return '\0';
    });
    expect(dirty.commit).toBe('4a428fcbd6b19b9b7ede0a06a115b1ee6cb742a8');
    expect(dirty.dirty).toBe(true);
    expect(dirty.dirtyPatchDigest).toMatch(/^[a-f0-9]{64}$/u);

    const unavailable = await collectSourceIdentity(repoRoot, async () => {
      throw new Error('no git');
    });
    expect(unavailable.commit).toBe('unknown');
    expect(unavailable.gitAvailable).toBe(false);
  });

  it('accepts bounded pipeline concurrency and records it in the manifest', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      requestedCaseConcurrency: 4,
      requestedJudgeConcurrency: 2,
    });
    expect(result.report.totalCases).toBe(3);
    const manifest = await readRunManifestArtifact(path.join(result.runDir, 'manifest.json'));
    expect(manifest.concurrency.requestedCases).toBe(4);
    expect(manifest.concurrency.requestedJudges).toBe(2);
    expect(manifest.concurrency.effectiveCases).toBe(4);
    expect(manifest.concurrency.effectiveJudges).toBe(2);
    expect(manifest.timeouts.suiteDeadlineMs).toBe(3_600_000);
    expect(manifest.timeouts.judgeTimeoutMs).toBe(60_000);
  });

  it('rejects out-of-range concurrency before any invocation', async () => {
    await expect(runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      requestedCaseConcurrency: 5,
      requestedJudgeConcurrency: 2,
    })).rejects.toThrow(/case-concurrency must be in 1\.\.4/);
    await expect(runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
      requestedCaseConcurrency: 1,
      requestedJudgeConcurrency: 3,
    })).rejects.toThrow(/judge-concurrency must be in 1\.\.2/);
  });

  it('parses labels and validates concurrency flags in the live CLI', () => {
    expect(parseRunLabel([])).toBe('candidate');
    expect(parseRunLabel(['--label', 'reference'])).toBe('reference');
    expect(parseRunLabel(['--label=frozen'])).toBe('frozen');
    expect(() => parseRunLabel(['--label'])).toThrow(/missing value/i);
    expect(parseCaseConcurrencyFlag([])).toBe(4);
    expect(parseCaseConcurrencyFlag(['--case-concurrency', '2'])).toBe(2);
    expect(parseJudgeConcurrencyFlag([])).toBe(2);
    expect(parseJudgeConcurrencyFlag(['--judge-concurrency=1'])).toBe(1);
    expect(() => parseCaseConcurrencyFlag(['--case-concurrency', '5'])).toThrow(/1\.\.4/);
    expect(() => parseJudgeConcurrencyFlag(['--judge-concurrency', '0'])).toThrow(/1\.\.2/);
    expect(() => parseCaseConcurrencyFlag(['--case-concurrency'])).toThrow(/missing value/i);
    expect(() => assertKnownFlags(['--case-concurrency=4'])).not.toThrow();
    expect(() => assertKnownFlags(['--bogus-flag'])).toThrow(/unknown flag/i);
    expect(() => assertKnownFlags([])).not.toThrow();
    expect(parseResumeMode([])).toBe('full');
    expect(parseResumeMode(['--resume-mode', 'diagnostic'])).toBe('diagnostic');
    expect(() => parseResumeMode(['--resume-mode', 'partial'])).toThrow(/full or diagnostic/);
  });

  it('keeps manifest case order aligned with executed results', async () => {
    const result = await runEvaluation({
      evalsDir,
      outputDir,
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
    });
    const manifest = await readRunManifestArtifact(path.join(result.runDir, 'manifest.json'));
    expect(manifest.cases.orderedIds).toEqual(result.report.results.map((entry) => entry.caseId));
  });
});
