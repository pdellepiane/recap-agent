import fs from 'node:fs/promises';
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
  codeShaToArtifactDigest,
  collectSourceIdentity,
  describeDevDeployment,
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
    // 2026-09-30 live compression: 119 - 27 merged threads = 92.
    expect(manifest.cases.orderedIds).toHaveLength(46);
    expect(new Set(manifest.cases.orderedIds).size).toBe(46);
    expect(manifest.cases.identities).toHaveLength(46);
    expect(() => runManifestSchema.parse(manifest)).not.toThrow();
    expect(() => assertUniqueConfigCasePairs(manifest.cases.identities)).not.toThrow();
  });

  it('writes the manifest before the first invocation with case order aligned to results', async () => {
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
    expect(manifest.cases.orderedIds).toEqual(result.report.results.map((entry) => entry.caseId));
  });

  it('detects fixture and hard-effect contract tampering', async () => {
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

    const index = selectedCases.findIndex((entry) =>
      entry.expectations.some((expectation) => expectation.type === 'fixture_effect_count'));
    expect(index).toBeGreaterThanOrEqual(0);
    const rubricMutated = selectedCases.map((entry) => ({ ...entry }));
    const victim = selectedCases[index];
    if (victim) {
      rubricMutated[index] = {
        ...victim,
        expectations: victim.expectations.map((expectation) =>
          expectation.type === 'fixture_effect_count'
            ? { ...expectation, expectedAttempts: expectation.expectedAttempts + 1 }
            : expectation),
      };
    }
    expect(() =>
      verifyManifestCases(
        manifest,
        [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
        rubricMutated,
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

  it('derives the artifact digest from CodeSha256 instead of fabricating it', () => {
    // Recorded 2026-09-21 development deployment: the deploy script's ZIP
    // digest equals the Lambda CodeSha256 bytes.
    expect(codeShaToArtifactDigest('UAy/lKn1FvNXSBCV6GZPxLoL3bVEGuD8O6bf4n6tORk=')).toBe(
      '500cbf94a9f516f357481095e8664fc4ba0bddb5441ae0fc3ba6dfe27ead3919',
    );
    expect(codeShaToArtifactDigest('')).toBeNull();
  });

  it('resolves live identity only through se-dev/us-east-1 on the dev function', async () => {
    const savedProfile = process.env.AWS_PROFILE;
    const savedRegion = process.env.AWS_REGION;
    const savedFunction = process.env.DEV_FUNCTION_NAME;
    try {
      process.env.AWS_PROFILE = 'default';
      expect(await describeDevDeployment()).toBeNull();
      process.env.AWS_PROFILE = 'se-dev';
      process.env.AWS_REGION = 'eu-west-1';
      expect(await describeDevDeployment()).toBeNull();
      process.env.AWS_REGION = 'us-east-1';
      process.env.DEV_FUNCTION_NAME = 'recap-agent-runtime';
      expect(await describeDevDeployment()).toBeNull();
    } finally {
      if (savedProfile === undefined) delete process.env.AWS_PROFILE;
      else process.env.AWS_PROFILE = savedProfile;
      if (savedRegion === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = savedRegion;
      if (savedFunction === undefined) delete process.env.DEV_FUNCTION_NAME;
      else process.env.DEV_FUNCTION_NAME = savedFunction;
    }
  });

  it('fails live preflight before paid calls without identity or digest', async () => {
    const selectedCases = (await loadLiveCases()).slice(0, 1);
    const liveConfig = [{ label: 'live', target: 'live_lambda' as const, notes: [], environmentOverrides: {} }];
    const missing = await buildRunManifest({
      runId: 'eval-test-no-identity',
      label: 'candidate',
      dryRun: false,
      repoRoot,
      outputDir,
      runConfigs: liveConfig,
      selectedCases,
      deploymentBefore: null,
      requestedConcurrency: { cases: 1, judges: 1 },
      startedAt: new Date().toISOString(),
      serviceLimits: null,
    });
    expect(missing.preflight.passed).toBe(false);
    expect(() => assertPreflightPassed(missing.preflight)).toThrow(/deployment identity or artifact digest/i);
    const digestless = await buildRunManifest({
      runId: 'eval-test-no-digest',
      label: 'candidate',
      dryRun: false,
      repoRoot,
      outputDir,
      runConfigs: liveConfig,
      selectedCases,
      deploymentBefore: fakeDeployment({ artifactSha256: null }),
      requestedConcurrency: { cases: 1, judges: 1 },
      startedAt: new Date().toISOString(),
      serviceLimits: null,
    });
    expect(digestless.preflight.passed).toBe(false);
    expect(() => assertPreflightPassed(digestless.preflight)).toThrow(/deployment identity or artifact digest/i);
  });

  it('keeps dry-run and offline preflight intact without identity', async () => {
    // Hermetic: buildRunManifest derives hasJudgeKey from
    // process.env.OPENAI_API_KEY, which vitest populates from the repo .env
    // when present. Control it explicitly so this test passes in checkouts
    // with and without that key.
    const savedJudgeKey = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = 'test-judge-key';
      const selectedCases = (await loadLiveCases()).slice(0, 1);
      const dry = await buildRunManifest({
        runId: 'eval-test-dry-no-identity',
        label: 'candidate',
        dryRun: true,
        repoRoot,
        outputDir,
        runConfigs: [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
        selectedCases,
        deploymentBefore: null,
        requestedConcurrency: { cases: 1, judges: 1 },
        startedAt: new Date().toISOString(),
        serviceLimits: null,
      });
      expect(dry.preflight.passed).toBe(true);
      // The identity exemption: a dry run executes no paid calls, so the
      // missing deployment identity warns instead of failing.
      expect(dry.preflight.checks.find((entry) => entry.id === 'deployed-identity')?.status).toBe('warn');
      expect(dry.preflight.checks.find((entry) => entry.id === 'judge-availability')?.status).toBe('pass');
      const offline = await buildRunManifest({
        runId: 'eval-test-offline-no-identity',
        label: 'candidate',
        dryRun: false,
        repoRoot,
        outputDir,
        runConfigs: [{ label: 'offline', target: 'offline', notes: [], environmentOverrides: {} }],
        selectedCases,
        deploymentBefore: null,
        requestedConcurrency: { cases: 1, judges: 1 },
        startedAt: new Date().toISOString(),
        serviceLimits: null,
      });
      expect(offline.preflight.passed).toBe(true);
      expect(offline.preflight.checks.find((entry) => entry.id === 'deployed-identity')?.status).toBe('pass');
      expect(offline.preflight.checks.find((entry) => entry.id === 'judge-availability')?.status).toBe('pass');
    } finally {
      if (savedJudgeKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedJudgeKey;
    }
  });

  it('rejects a null after-identity on live completion like a mismatch', async () => {
    const selectedCases = (await loadLiveCases()).slice(0, 1);
    const manifest = await buildRunManifest({
      runId: 'eval-test-null-after',
      label: 'candidate',
      dryRun: false,
      repoRoot,
      outputDir,
      runConfigs: [{ label: 'live', target: 'live_lambda', notes: [], environmentOverrides: {} }],
      selectedCases,
      deploymentBefore: fakeDeployment(),
      requestedConcurrency: { cases: 1, judges: 1 },
      startedAt: new Date().toISOString(),
      serviceLimits: null,
    });
    expect(() => finalizeRunManifest(manifest, {
      deploymentAfter: null,
      completedAt: new Date().toISOString(),
      providerModelIdentities: [],
      requireAfterIdentity: true,
    })).toThrow(/cannot prove the artifact it ended on/i);
    // Dry and offline completions still accept a null after-identity.
    expect(() => finalizeRunManifest(manifest, {
      deploymentAfter: null,
      completedAt: new Date().toISOString(),
      providerModelIdentities: [],
    })).not.toThrow();
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

  it('reconciles frozen support-gate counts from the catalog suite (46 total / 43 support)', async () => {
    const catalog = await new EvalLoader(evalsDir).loadCatalog();
    const suite = catalog.suites.find((entry) => entry.id === 'live_behavior_regression');
    expect(suite).toBeDefined();
    const suiteIds = new Set(suite?.caseIds ?? []);
    const frozen = JSON.parse(
      await fs.readFile(
        path.join(repoRoot, 'docs/plan/2026-09-09-lean-conversation/support-gate-2026-09-16.json'),
        'utf8',
      ),
    ) as { supportDenominator: number; supportIds: string[]; planningDiagnosticOnly: string[] };
    // Computed from the catalog/suite files, never a stale hardcode elsewhere.
    // 2026-09-24 FAQ commission: 138 + 1 full-article citation case.
    // 2026-09-29 inbound identity: +1 foreign-number RSVP decline case.
    // 2026-09-29 hosted history: +1 phone-hosted-event-history case.
    // 2026-09-30 test condensation: 143 - 24 merged threads = 119 (111 support).
    // 2026-09-30 live compression: 119 - 27 merged threads = 92 (84 support).
    expect(suiteIds.size).toBe(46);
    expect(frozen.supportDenominator).toBe(43);
    expect(frozen.supportIds).toHaveLength(43);
    expect(frozen.planningDiagnosticOnly).toHaveLength(3);
    expect(new Set([...frozen.supportIds, ...frozen.planningDiagnosticOnly])).toEqual(suiteIds);
    expect(frozen.supportIds).toContain('live_behavior.customer_event_task_continuity');
    expect(frozen.supportIds).toContain('live_behavior.image_file_delayed_question');
    // wait_followup_no_repeat merged into support_pending_question_completed
    // (asserted above); the s3 survivor carries the absorbed s2 thread.
    expect(frozen.supportIds).toContain('live_behavior.image_unavailable_captioned');
    // Merged from the F3 high-risk twins suite reconciliation: every
    // planning-diagnostic id stays a member of the mandatory suite.
    for (const planningId of frozen.planningDiagnosticOnly) {
      expect(suiteIds.has(planningId), `${planningId} missing from the mandatory suite`).toBe(true);
    }
    const selectedCases = await loadLiveCases();
    expect(selectedCases).toHaveLength(suiteIds.size);
    expect(new Set(selectedCases.map((entry) => entry.id))).toEqual(suiteIds);
  });

  it('task-continuity oracle binds per-turn runtime effects instead of fixture inspection', async () => {
    const catalog = await new EvalLoader(evalsDir).loadCatalog();
    const continuity = catalog.cases.find(
      (entry) => entry.id === 'live_behavior.customer_event_task_continuity',
    );
    expect(continuity).toBeDefined();
    expect(continuity?.inputs).toHaveLength(4);
    const effects = (continuity?.expectations ?? []).filter(
      (entry) => entry.type === 'fixture_effect_count',
    );
    // One hard effect receipt per turn: three zero-write turns plus the single Marta write.
    expect(effects.filter((entry) => entry.severity === 'hard')).toHaveLength(4);
    const tools = (continuity?.expectations ?? []).filter((entry) => entry.type === 'tool_usage');
    expect(tools.length).toBeGreaterThan(0);
    for (const entry of tools) {
      expect(entry.severity).toBe('hard');
    }
    for (const entry of continuity?.expectations ?? []) {
      if (entry.type === 'text_semantic') {
        expect(entry.severity).toBe('hard');
        expect(entry.requireJudge).toBe(true);
      }
    }
  });
});
