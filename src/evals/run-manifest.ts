import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { DEFAULT_GPT_TEXT_MODEL, DEFAULT_PROMPT_CACHE_OPTIONS } from '../runtime/openai-model-defaults';
import type { EvalCase, EvalRunConfig, EvalTargetMode } from './case-schema';

/**
 * Packet O0 — freeze identity and establish one source of truth.
 *
 * This module builds, writes, and verifies the run manifest that must exist
 * before the first evaluation invocation. It records source, artifact,
 * evaluator, case, model, concurrency, timeout, and environment identity so a
 * later run can detect fixture/rubric/artifact drift. It performs no case
 * execution and changes no scheduling behavior.
 */

export const RUN_MANIFEST_SCHEMA_VERSION = 1;

/** Current runner executes cases serially; parallelism lands in O2. */
export const SERIAL_CASE_CONCURRENCY = 1;
export const SERIAL_JUDGE_CONCURRENCY = 1;

/**
 * Packet O2 enforced defaults: four case workers (one external lane at
 * most), two judge requests in flight. Strict range 1..4 / 1..2.
 */
export const DEFAULT_CASE_CONCURRENCY = 4;
export const DEFAULT_JUDGE_CONCURRENCY = 2;

/** Live Lambda per-turn request bound already enforced by the live target. */
export const LIVE_TURN_TIMEOUT_MS = 95_000;

/** Packet O3 explicit judge policy enforced by the runner-owned retry. */
export const JUDGE_TIMEOUT_MS = 60_000;
export const JUDGE_MAX_RETRIES = 1;

/** O2 specified values, recorded here as specified-not-enforced. */
export const SPECIFIED_SUITE_DEADLINE_MS = 3_600_000;
export const SPECIFIED_SUITE_DRAIN_MS = 300_000;

export const REQUIRED_LOCAL_AWS_ACCOUNT = '684516060775';
export const DEV_FUNCTION_NAME = 'recap-agent-runtime-dev';
export const DEV_STACK_NAME = 'recap-agent-runtime-dev';

export const deploymentIdentitySchema = z.object({
  functionArn: z.string().min(1),
  codeSha256: z.string().min(1),
  version: z.string().min(1),
  lastModified: z.string().min(1),
  artifactSha256: z.string().nullable(),
  artifactProvenance: z.enum(['verified-aws', 'log-observation', 'unverified']),
  checkedAt: z.string().min(1),
});
export type DeploymentIdentity = z.infer<typeof deploymentIdentitySchema>;

const sourceIdentitySchema = z.object({
  commit: z.string().min(1),
  gitAvailable: z.boolean(),
  dirty: z.boolean(),
  dirtyPatchDigest: z.string().nullable(),
  untrackedContentDigest: z.string().nullable(),
});

const caseIdentitySchema = z.object({
  configLabel: z.string().min(1),
  caseId: z.string().min(1),
  pairId: z.string().regex(/^[a-f0-9]{64}$/u),
  caseDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  fixtureDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  rubricDigest: z.string().regex(/^[a-f0-9]{64}$/u),
});

const preflightCheckSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pass', 'fail', 'warn']),
  detail: z.string().min(1),
});

export const runManifestSchema = z.object({
  schemaVersion: z.literal(RUN_MANIFEST_SCHEMA_VERSION),
  runId: z.string().min(1),
  label: z.string().min(1),
  dryRun: z.boolean(),
  releaseReadyClaim: z.literal(false),
  referenceStatus: z.string().min(1),
  source: sourceIdentitySchema,
  deploymentBefore: deploymentIdentitySchema.nullable(),
  deploymentAfter: deploymentIdentitySchema.nullable(),
  artifact: z.object({
    artifactSha256: z.string().nullable(),
    codeSha256: z.string().nullable(),
    version: z.string().nullable(),
    lastModified: z.string().nullable(),
    provenance: z.enum(['verified-aws', 'log-observation', 'unverified', 'unknown']),
  }),
  lockfiles: z.record(z.string(), z.string().nullable()),
  prompts: z.object({
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    fileCount: z.number().int().nonnegative(),
  }),
  evaluator: z.object({
    commit: z.string().min(1),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  cases: z.object({
    orderedIds: z.array(z.string().min(1)),
    identities: z.array(caseIdentitySchema),
  }),
  models: z.object({
    reply: z.string().min(1),
    extractor: z.string().min(1),
    classifier: z.string().min(1),
    judgeModels: z.array(z.string().min(1)),
    promptCache: z.object({
      mode: z.string().min(1),
      ttl: z.string().min(1),
    }),
    configSettings: z.array(z.object({
      label: z.string().min(1),
      replyModel: z.string().nullable(),
      extractorModel: z.string().nullable(),
      reasoningEffort: z.string().nullable(),
      promptBundleLabel: z.string().nullable(),
    })),
  }),
  concurrency: z.object({
    requestedCases: z.number().int().min(1).max(4),
    requestedJudges: z.number().int().min(1).max(2),
    effectiveCases: z.number().int().min(1),
    effectiveJudges: z.number().int().min(1),
  }),
  timeouts: z.object({
    perTurnMs: z.number().int().positive(),
    suiteDeadlineMs: z.number().int().positive().nullable(),
    drainMs: z.number().int().positive().nullable(),
    judgeTimeoutMs: z.number().int().positive().nullable(),
    judgeMaxRetries: z.number().int().nonnegative().nullable(),
  }),
  startedAt: z.string().min(1),
  completedAt: z.string().nullable(),
  env: z.object({
    nodeVersion: z.string().min(1),
    platform: z.string().min(1),
    awsProfile: z.string().nullable(),
    awsRegion: z.string().min(1),
    stackName: z.string().min(1),
    openaiSdk: z.string().nullable(),
    agentsSdk: z.string().nullable(),
  }),
  providerModelIdentities: z.array(z.string().min(1)),
  preflight: z.object({
    passed: z.boolean(),
    checks: z.array(preflightCheckSchema),
  }),
  notes: z.array(z.string()),
});
export type RunManifest = z.infer<typeof runManifestSchema>;
export type PreflightCheck = z.infer<typeof preflightCheckSchema>;

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, canonicalize(entry)] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

export function digestJson(value: unknown): string {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}

function defaultGitRunner(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export async function collectSourceIdentity(
  repoRoot: string,
  gitRunner: GitRunner = defaultGitRunner,
): Promise<RunManifest['source']> {
  let commit: string;
  try {
    commit = (await gitRunner(['rev-parse', 'HEAD'], repoRoot)).trim();
  } catch {
    return {
      commit: 'unknown',
      gitAvailable: false,
      dirty: true,
      dirtyPatchDigest: null,
      untrackedContentDigest: null,
    };
  }
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    return {
      commit: 'unknown',
      gitAvailable: false,
      dirty: true,
      dirtyPatchDigest: null,
      untrackedContentDigest: null,
    };
  }
  let patch = '';
  try {
    patch = await gitRunner(['diff', 'HEAD', '--no-color', '--no-ext-diff'], repoRoot);
  } catch {
    patch = '';
  }
  const dirtyPatchDigest = patch.trim().length > 0 ? sha256Hex(patch) : null;
  const untrackedContentDigest = await digestUntrackedContent(repoRoot, gitRunner);
  return {
    commit,
    gitAvailable: true,
    dirty: dirtyPatchDigest !== null || untrackedContentDigest !== null,
    dirtyPatchDigest,
    untrackedContentDigest,
  };
}

async function digestUntrackedContent(
  repoRoot: string,
  gitRunner: GitRunner,
): Promise<string | null> {
  let status = '';
  try {
    status = await gitRunner(['status', '--porcelain=v1', '--untracked-files=all', '-z'], repoRoot);
  } catch {
    return null;
  }
  const untracked = status
    .split('\0')
    .filter((entry) => entry.startsWith('?? '))
    .map((entry) => entry.slice(3).trim())
    .filter((entry) => entry.length > 0 && !entry.includes('/.eval-runs'))
    .sort();
  if (untracked.length === 0) {
    return null;
  }
  const pieces: string[] = [];
  for (const relativePath of untracked) {
    try {
      const stat = await fs.stat(path.join(repoRoot, relativePath));
      if (!stat.isFile()) {
        continue;
      }
      const content = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      pieces.push(`${relativePath}\0${content}`);
    } catch {
      pieces.push(`${relativePath}\0<unreadable>`);
    }
  }
  if (pieces.length === 0) {
    return null;
  }
  return sha256Hex(pieces.join('\n'));
}

async function walkFiles(root: string, relative: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const sorted = entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of sorted) {
    const next = relative.length > 0 ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      await walkFiles(root, next, out);
    } else if (entry.isFile()) {
      out.push(next);
    }
  }
}

export async function digestDirectoryFiles(
  repoRoot: string,
  relativeDir: string,
  extensions: readonly string[] | null = null,
): Promise<{ digest: string; fileCount: number }> {
  const collected: string[] = [];
  try {
    await walkFiles(repoRoot, relativeDir, collected);
  } catch {
    return { digest: sha256Hex('missing-dir'), fileCount: 0 };
  }
  const selected = collected
    .filter((entry) => (extensions === null ? true : extensions.some((ext) => entry.endsWith(ext))))
    .sort();
  const pieces: string[] = [];
  for (const relativePath of selected) {
    try {
      const content = await fs.readFile(path.join(repoRoot, relativePath));
      pieces.push(`${relativePath}\0${content.toString('hex')}`);
    } catch {
      pieces.push(`${relativePath}\0<unreadable>`);
    }
  }
  return { digest: sha256Hex(pieces.join('\n')), fileCount: selected.length };
}

export async function collectLockfileDigests(repoRoot: string): Promise<Record<string, string | null>> {
  const names = ['package-lock.json', 'bun.lock'];
  const result: Record<string, string | null> = {};
  for (const name of names) {
    try {
      const content = await fs.readFile(path.join(repoRoot, name));
      result[name] = crypto.createHash('sha256').update(content).digest('hex');
    } catch {
      result[name] = null;
    }
  }
  return result;
}

export async function collectEvaluatorContentDigest(repoRoot: string): Promise<string> {
  const parts: string[] = [];
  const evalsCases = await digestDirectoryFiles(repoRoot, 'evals/cases', ['.yaml', '.yml', '.json']);
  parts.push(`cases:${evalsCases.digest}:${evalsCases.fileCount}`);
  const evalsSuites = await digestDirectoryFiles(repoRoot, 'evals/suites', ['.yaml', '.yml', '.json']);
  parts.push(`suites:${evalsSuites.digest}:${evalsSuites.fileCount}`);
  const scorers = await digestDirectoryFiles(repoRoot, 'src/evals', ['.ts']);
  parts.push(`src-evals:${scorers.digest}:${scorers.fileCount}`);
  try {
    const coverage = await fs.readFile(path.join(repoRoot, 'evals/live-behavior-coverage.yaml'), 'utf8');
    parts.push(`coverage:${sha256Hex(coverage)}`);
  } catch {
    parts.push('coverage:<missing>');
  }
  return sha256Hex(parts.join('\n'));
}

export async function collectSdkVersions(
  repoRoot: string,
): Promise<{ openaiSdk: string | null; agentsSdk: string | null }> {
  const readInstalled = async (name: string): Promise<string | null> => {
    try {
      const raw = await fs.readFile(path.join(repoRoot, 'node_modules', name, 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      return typeof parsed.version === 'string' ? parsed.version : null;
    } catch {
      return null;
    }
  };
  return {
    openaiSdk: await readInstalled('openai'),
    agentsSdk: await readInstalled('@openai/agents'),
  };
}

export function resolveModelIdentity(selectedCases: EvalCase[]): RunManifest['models'] {
  const reply = process.env.OPENAI_MODEL ?? DEFAULT_GPT_TEXT_MODEL;
  const extractor = process.env.OPENAI_EXTRACTOR_MODEL ?? reply;
  const classifier = process.env.OPENAI_RESPONSE_CLASSIFIER_MODEL ?? reply;
  const judges = new Set<string>([DEFAULT_GPT_TEXT_MODEL]);
  for (const currentCase of selectedCases) {
    for (const expectation of currentCase.expectations) {
      if (expectation.type === 'text_semantic' && expectation.judgeModel) {
        judges.add(expectation.judgeModel);
      }
    }
    for (const scorer of currentCase.scorers) {
      if (scorer.type === 'text_semantic' && scorer.judgeModel) {
        judges.add(scorer.judgeModel);
      }
    }
  }
  return {
    reply,
    extractor,
    classifier,
    judgeModels: [...judges].sort(),
    promptCache: {
      mode: DEFAULT_PROMPT_CACHE_OPTIONS.mode,
      ttl: DEFAULT_PROMPT_CACHE_OPTIONS.ttl,
    },
    configSettings: [],
  };
}

export function digestCaseForManifest(currentCase: EvalCase): {
  caseDigest: string;
  fixtureDigest: string;
  rubricDigest: string;
} {
  const caseDigest = digestJson({
    id: currentCase.id,
    suite: currentCase.suite,
    version: currentCase.version,
    inputs: currentCase.inputs,
    seedPlan: currentCase.seedPlan ?? null,
    configOverrides: currentCase.configOverrides ?? null,
    expectations: currentCase.expectations,
    scorers: currentCase.scorers,
  });
  const fixtureDigest = digestJson({
    backendFixture: currentCase.backendFixture ?? null,
    inputFixtures: currentCase.inputs.map((input) => input.backendFixture ?? null),
    offlineFixture: currentCase.fixtures?.offline ?? null,
    rsvpIsolation: currentCase.rsvpIsolation ?? null,
  });
  const rubrics = [
    ...currentCase.expectations
      .filter((expectation) => expectation.type === 'text_semantic')
      .map((expectation) => {
        const semantic = expectation as Extract<EvalCase['expectations'][number], { type: 'text_semantic' }>;
        return {
          rubric: semantic.rubric,
          minScore: semantic.minScore,
          requireJudge: semantic.requireJudge,
          severity: semantic.severity,
          judgeModel: semantic.judgeModel ?? null,
        };
      }),
    ...currentCase.scorers
      .filter((scorer) => scorer.type === 'text_semantic')
      .map((scorer) => {
        const semantic = scorer as Extract<EvalCase['scorers'][number], { type: 'text_semantic' }>;
        return { rubric: semantic.rubric, judgeModel: semantic.judgeModel ?? null };
      }),
  ];
  return { caseDigest, fixtureDigest, rubricDigest: digestJson(rubrics) };
}

export function buildConfigCaseIdentities(
  runConfigs: EvalRunConfig[],
  selectedCases: EvalCase[],
): RunManifest['cases']['identities'] {
  const configSettingsDigest = (config: EvalRunConfig): string =>
    digestJson({
      label: config.label,
      target: config.target,
      replyModel: config.replyModel ?? null,
      extractorModel: config.extractorModel ?? null,
      reasoningEffort: config.reasoningEffort ?? null,
      promptBundleLabel: config.promptBundleLabel ?? null,
      environmentOverrides: config.environmentOverrides,
      liveLambda: config.liveLambda ?? null,
    });
  const identities: RunManifest['cases']['identities'] = [];
  for (const config of runConfigs) {
    const settingsDigest = configSettingsDigest(config);
    for (const currentCase of selectedCases) {
      if (!currentCase.targetModes.includes(config.target)) {
        continue;
      }
      const digests = digestCaseForManifest(currentCase);
      identities.push({
        configLabel: config.label,
        caseId: currentCase.id,
        pairId: sha256Hex(`${config.label}\0${currentCase.id}\0${settingsDigest}`),
        caseDigest: digests.caseDigest,
        fixtureDigest: digests.fixtureDigest,
        rubricDigest: digests.rubricDigest,
      });
    }
  }
  return identities;
}

export function assertUniqueConfigCasePairs(
  identities: ReadonlyArray<{ configLabel: string; caseId: string; pairId: string }>,
): void {
  const seen = new Set<string>();
  const keySeen = new Set<string>();
  for (const identity of identities) {
    const key = `${identity.configLabel}::${identity.caseId}`;
    if (keySeen.has(key)) {
      throw new Error(`Duplicate config/case pair identity: ${key}.`);
    }
    keySeen.add(key);
    if (seen.has(identity.pairId)) {
      throw new Error(`Duplicate config/case pair digest: ${key}.`);
    }
    seen.add(identity.pairId);
  }
}

export function verifyManifestCases(
  manifest: RunManifest,
  runConfigs: EvalRunConfig[],
  selectedCases: EvalCase[],
): void {
  const orderedIds = selectedCases.map((currentCase) => currentCase.id);
  if (JSON.stringify(manifest.cases.orderedIds) !== JSON.stringify(orderedIds)) {
    throw new Error(
      `Run manifest case order drifted: expected [${orderedIds.join(', ')}] but manifest holds [${manifest.cases.orderedIds.join(', ')}].`,
    );
  }
  const expected = buildConfigCaseIdentities(runConfigs, selectedCases);
  assertUniqueConfigCasePairs(expected);
  const actualByPair = new Map(manifest.cases.identities.map((entry) => [entry.pairId, entry]));
  if (actualByPair.size !== manifest.cases.identities.length) {
    throw new Error('Run manifest holds duplicate config/case pair digests.');
  }
  for (const entry of expected) {
    const actual = actualByPair.get(entry.pairId);
    if (!actual) {
      throw new Error(`Run manifest is missing config/case pair ${entry.configLabel}::${entry.caseId}.`);
    }
    if (actual.caseDigest !== entry.caseDigest) {
      throw new Error(`Case content drifted for ${entry.caseId} (config ${entry.configLabel}).`);
    }
    if (actual.fixtureDigest !== entry.fixtureDigest) {
      throw new Error(`Fixture drifted for ${entry.caseId} (config ${entry.configLabel}).`);
    }
    if (actual.rubricDigest !== entry.rubricDigest) {
      throw new Error(`Rubric drifted for ${entry.caseId} (config ${entry.configLabel}).`);
    }
  }
  if (actualByPair.size !== expected.length) {
    throw new Error('Run manifest holds unexpected config/case pairs.');
  }
}

export function verifyManifestArtifact(
  manifest: RunManifest,
  observed: DeploymentIdentity | null,
): void {
  if (!observed) {
    return;
  }
  const expectedCode = manifest.artifact.codeSha256;
  if (expectedCode && observed.codeSha256 !== expectedCode) {
    throw new Error(
      `Artifact drifted: manifest pins CodeSha256 ${expectedCode} but observed ${observed.codeSha256}.`,
    );
  }
  const expectedArtifact = manifest.artifact.artifactSha256;
  if (expectedArtifact && observed.artifactSha256 && observed.artifactSha256 !== expectedArtifact) {
    throw new Error(
      `Artifact drifted: manifest pins artifact ${expectedArtifact} but observed ${observed.artifactSha256}.`,
    );
  }
}

export type PreflightInput = {
  repoRoot: string;
  outputDir: string;
  runId: string;
  targets: EvalTargetMode[];
  selectedCases: EvalCase[];
  runConfigs: EvalRunConfig[];
  dryRun: boolean;
  hasJudgeKey: boolean;
  deploymentBefore: DeploymentIdentity | null;
  sdkVersions: { openaiSdk: string | null; agentsSdk: string | null };
  serviceLimits: { maxConcurrentCases: number; maxConcurrentJudges: number } | null;
  requestedConcurrency: { cases: number; judges: number };
};

function check(id: string, status: PreflightCheck['status'], detail: string): PreflightCheck {
  return { id, status, detail };
}

export async function runManifestPreflight(input: PreflightInput): Promise<{
  passed: boolean;
  checks: PreflightCheck[];
}> {
  const checks: PreflightCheck[] = [];
  const isLive = input.targets.includes('live_lambda');

  if (input.selectedCases.length === 0) {
    if (input.dryRun) {
      checks.push(check('selected-count', 'warn', 'Zero cases selected on a dry run; no invocations will occur.'));
    } else {
      checks.push(check('selected-count', 'fail', 'Zero cases selected; a live evaluation with no cases is incomplete.'));
    }
  } else {
    checks.push(check('selected-count', 'pass', `Selected ${input.selectedCases.length} cases.`));
  }

  const ids = input.selectedCases.map((currentCase) => currentCase.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  checks.push(
    duplicates.length > 0
      ? check('duplicate-ids', 'fail', `Duplicate case IDs: ${[...new Set(duplicates)].join(', ')}.`)
      : check('duplicate-ids', 'pass', 'Case IDs are unique.'),
  );

  try {
    assertUniqueConfigCasePairs(buildConfigCaseIdentities(input.runConfigs, input.selectedCases));
    checks.push(check('config-case-identity', 'pass', 'Every config/case pair has a unique identity.'));
  } catch (error) {
    checks.push(check('config-case-identity', 'fail', error instanceof Error ? error.message : String(error)));
  }

  if (!isLive) {
    checks.push(check('judge-availability', 'pass', 'Offline target performs no semantic judging.'));
    checks.push(check('credentials', 'pass', 'Offline target requires no AWS credentials.'));
  } else if (!input.hasJudgeKey) {
    checks.push(check(
      'judge-availability',
      'fail',
      'Live behavior regressions require mandatory semantic judges but OPENAI_API_KEY is absent.',
    ));
    checks.push(
      input.dryRun
        ? check('credentials', 'pass', 'Dry run performs no AWS calls.')
        : check(
          'credentials',
          process.env.AWS_PROFILE || process.env.AWS_ACCESS_KEY_ID ? 'pass' : 'warn',
          'Live target resolves AWS credentials at invocation; profile presence is advisory only and no secret was read.',
        ),
    );
  } else {
    checks.push(check('judge-availability', 'pass', 'Judge key is present (value never printed).'));
    checks.push(
      input.dryRun
        ? check('credentials', 'pass', 'Dry run performs no AWS calls.')
        : check(
          'credentials',
          process.env.AWS_PROFILE || process.env.AWS_ACCESS_KEY_ID ? 'pass' : 'warn',
          'Live target resolves AWS credentials at invocation; profile presence is advisory only and no secret was read.',
        ),
    );
  }

  const emptyScenarios = input.selectedCases.filter((currentCase) => {
    const scenarios = [
      currentCase.backendFixture?.scenario,
      ...currentCase.inputs.map((turn) => turn.backendFixture?.scenario),
    ].filter((scenario): scenario is string => typeof scenario === 'string');
    return scenarios.some((scenario) => scenario.trim().length === 0);
  });
  const withBackendFixture = input.selectedCases.filter(
    (currentCase) => currentCase.backendFixture ?? currentCase.inputs.some((turn) => turn.backendFixture),
  ).length;
  const withRsvpHooks = input.selectedCases.filter((currentCase) => currentCase.rsvpIsolation).length;
  checks.push(
    emptyScenarios.length > 0
      ? check('fixture-completeness', 'fail', `Cases with empty fixture scenarios: ${emptyScenarios.map((currentCase) => currentCase.id).join(', ')}.`)
      : check(
        'fixture-completeness',
        'pass',
        `${withBackendFixture} cases reference a backend fixture, ${withRsvpHooks} declare RSVP hooks, ${input.selectedCases.length - withBackendFixture} run without one.`,
      ),
  );

  try {
    const probeDir = path.join(input.outputDir, input.runId);
    await fs.mkdir(probeDir, { recursive: true });
    await fs.writeFile(path.join(probeDir, '.preflight-probe'), 'writable', 'utf8');
    await fs.rm(path.join(probeDir, '.preflight-probe'));
    checks.push(check('disk-writability', 'pass', `Run directory ${probeDir} is writable.`));
  } catch (error) {
    checks.push(check('disk-writability', 'fail', `Run directory is not writable: ${error instanceof Error ? error.message : String(error)}.`));
  }

  if (!isLive) {
    checks.push(check('deployed-identity', 'pass', 'Offline target has no deployed artifact to pin.'));
  } else if (input.deploymentBefore) {
    checks.push(check(
      'deployed-identity',
      'pass',
      `Pinned ${input.deploymentBefore.functionArn} CodeSha256 ${input.deploymentBefore.codeSha256.slice(0, 12)} version ${input.deploymentBefore.version}.`,
    ));
  } else {
    checks.push(check(
      'deployed-identity',
      'warn',
      'No pre-run deployment identity was supplied; the run cannot prove it stayed on one artifact.',
    ));
  }

  checks.push(
    input.sdkVersions.openaiSdk && input.sdkVersions.agentsSdk
      ? check(
        'sdk-versions',
        'pass',
        `openai ${input.sdkVersions.openaiSdk}, @openai/agents ${input.sdkVersions.agentsSdk}.`,
      )
      : check('sdk-versions', 'warn', 'One or more SDK versions could not be resolved from node_modules.'),
  );

  if (!input.serviceLimits) {
    checks.push(check(
      'service-limits',
      'warn',
      'Configured service limits are undiscovered; capacity against 4 cases / 2 judges is unproven and no default was changed.',
    ));
  } else if (
    input.serviceLimits.maxConcurrentCases < input.requestedConcurrency.cases ||
    input.serviceLimits.maxConcurrentJudges < input.requestedConcurrency.judges
  ) {
    checks.push(check(
      'service-limits',
      'fail',
      `Capacity deficiency: limits allow ${input.serviceLimits.maxConcurrentCases} cases / ${input.serviceLimits.maxConcurrentJudges} judges but the manifest requests ${input.requestedConcurrency.cases} / ${input.requestedConcurrency.judges}; refusing to silently reduce the configuration.`,
    ));
  } else {
    checks.push(check(
      'service-limits',
      'pass',
      `Limits allow ${input.serviceLimits.maxConcurrentCases} cases / ${input.serviceLimits.maxConcurrentJudges} judges; requested ${input.requestedConcurrency.cases} / ${input.requestedConcurrency.judges}.`,
    ));
  }

  const failed = checks.filter((entry) => entry.status === 'fail');
  return { passed: failed.length === 0, checks };
}

export function assertPreflightPassed(preflight: { passed: boolean; checks: PreflightCheck[] }): void {
  if (preflight.passed) {
    return;
  }
  const failures = preflight.checks.filter((entry) => entry.status === 'fail');
  throw new Error(`Evaluation preflight failed: ${failures.map((entry) => `${entry.id}: ${entry.detail}`).join(' | ')}`);
}

export type ManifestBuildInput = {
  runId: string;
  label: string;
  dryRun: boolean;
  repoRoot: string;
  outputDir: string;
  runConfigs: EvalRunConfig[];
  selectedCases: EvalCase[];
  deploymentBefore: DeploymentIdentity | null;
  requestedConcurrency: { cases: number; judges: number };
  startedAt: string;
  serviceLimits: PreflightInput['serviceLimits'];
  gitRunner?: GitRunner;
};

export async function buildRunManifest(input: ManifestBuildInput): Promise<RunManifest> {
  const source = await collectSourceIdentity(input.repoRoot, input.gitRunner);
  const lockfiles = await collectLockfileDigests(input.repoRoot);
  const prompts = await digestDirectoryFiles(input.repoRoot, 'prompts', null);
  const evaluatorContentDigest = await collectEvaluatorContentDigest(input.repoRoot);
  const sdkVersions = await collectSdkVersions(input.repoRoot);
  const models = resolveModelIdentity(input.selectedCases);
  models.configSettings = input.runConfigs.map((config) => ({
    label: config.label,
    replyModel: config.replyModel ?? null,
    extractorModel: config.extractorModel ?? null,
    reasoningEffort: config.reasoningEffort ?? null,
    promptBundleLabel: config.promptBundleLabel ?? null,
  }));
  const identities = buildConfigCaseIdentities(input.runConfigs, input.selectedCases);
  assertUniqueConfigCasePairs(identities);
  const targets = [...new Set(input.runConfigs.map((config) => config.target))];
  const preflight = await runManifestPreflight({
    repoRoot: input.repoRoot,
    outputDir: input.outputDir,
    runId: input.runId,
    targets,
    selectedCases: input.selectedCases,
    runConfigs: input.runConfigs,
    dryRun: input.dryRun,
    hasJudgeKey: (process.env.OPENAI_API_KEY ?? '').length > 0,
    deploymentBefore: input.deploymentBefore,
    sdkVersions,
    serviceLimits: input.serviceLimits,
    requestedConcurrency: input.requestedConcurrency,
  });
  const deployment = input.deploymentBefore;
  return runManifestSchema.parse({
    schemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
    runId: input.runId,
    label: input.label,
    dryRun: input.dryRun,
    releaseReadyClaim: false,
    referenceStatus: 'red',
    source,
    deploymentBefore: deployment,
    deploymentAfter: null,
    artifact: {
      artifactSha256: deployment?.artifactSha256 ?? null,
      codeSha256: deployment?.codeSha256 ?? null,
      version: deployment?.version ?? null,
      lastModified: deployment?.lastModified ?? null,
      provenance: deployment ? deployment.artifactProvenance : 'unknown',
    },
    lockfiles,
    prompts: { digest: prompts.digest, fileCount: prompts.fileCount },
    evaluator: { commit: source.commit, contentDigest: evaluatorContentDigest },
    cases: {
      orderedIds: input.selectedCases.map((currentCase) => currentCase.id),
      identities,
    },
    models,
    concurrency: {
      requestedCases: input.requestedConcurrency.cases,
      requestedJudges: input.requestedConcurrency.judges,
      effectiveCases: input.requestedConcurrency.cases,
      effectiveJudges: input.requestedConcurrency.judges,
    },
    timeouts: {
      perTurnMs: LIVE_TURN_TIMEOUT_MS,
      suiteDeadlineMs: SPECIFIED_SUITE_DEADLINE_MS,
      drainMs: SPECIFIED_SUITE_DRAIN_MS,
      judgeTimeoutMs: JUDGE_TIMEOUT_MS,
      judgeMaxRetries: JUDGE_MAX_RETRIES,
    },
    startedAt: input.startedAt,
    completedAt: null,
    env: {
      nodeVersion: process.version,
      platform: process.platform,
      awsProfile: process.env.AWS_PROFILE ?? null,
      awsRegion: process.env.AWS_REGION ?? 'us-east-1',
      stackName: process.env.DEV_STACK_NAME ?? DEV_STACK_NAME,
      openaiSdk: sdkVersions.openaiSdk,
      agentsSdk: sdkVersions.agentsSdk,
    },
    providerModelIdentities: [],
    preflight,
    notes: [
      'O2/O3 bounded pipeline: configurations sequential, up to 4 case workers with a single external lane, 2 judge requests in flight, 8-snapshot backpressure queue.',
      'Judge policy explicit: 60s request timeout, SDK maxRetries=0, one runner-owned retry only for transient transport/429/5xx after Retry-After (<=30s) or 2s.',
      'Suite coordinator deadline 60 minutes with a 5-minute bounded drain; per-turn Lambda bound stays 95s.',
    ],
  });
}

export function finalizeRunManifest(
  manifest: RunManifest,
  update: {
    deploymentAfter: DeploymentIdentity | null;
    completedAt: string;
    providerModelIdentities: string[];
  },
): RunManifest {
  const finalized = runManifestSchema.parse({
    ...manifest,
    deploymentAfter: update.deploymentAfter,
    completedAt: update.completedAt,
    providerModelIdentities: [...update.providerModelIdentities].sort(),
  });
  const before = finalized.deploymentBefore;
  const after = finalized.deploymentAfter;
  if (before && after && before.codeSha256 !== after.codeSha256) {
    throw new Error(
      `Mixed-artifact evidence rejected: run started on CodeSha256 ${before.codeSha256} but ended on ${after.codeSha256}. The gate is invalid.`,
    );
  }
  return finalized;
}

export function digestManifest(manifest: RunManifest): string {
  return digestJson(manifest);
}

/** Read-only deployment identity for the development function (no deploy). */
export async function describeDevDeployment(options?: {
  functionName?: string;
  region?: string;
}): Promise<DeploymentIdentity | null> {
  const functionName = options?.functionName ?? process.env.DEV_FUNCTION_NAME ?? DEV_FUNCTION_NAME;
  const region = options?.region ?? process.env.AWS_REGION ?? 'us-east-1';
  try {
    const { LambdaClient, GetFunctionConfigurationCommand } = await import('@aws-sdk/client-lambda');
    const client = new LambdaClient({ region });
    const response = await client.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
    if (!response.FunctionArn || !response.CodeSha256) {
      return null;
    }
    return deploymentIdentitySchema.parse({
      functionArn: response.FunctionArn,
      codeSha256: response.CodeSha256,
      version: response.Version ?? '$LATEST',
      lastModified: response.LastModified ?? new Date(0).toISOString(),
      artifactSha256: null,
      artifactProvenance: 'unverified',
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return null;
  }
}
