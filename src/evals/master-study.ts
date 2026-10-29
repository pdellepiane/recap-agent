import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { EvalCase } from './case-schema';
import { digestJson } from './run-manifest';

export const masterProtocolSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/u),
  version: z.literal(1),
  status: z.literal('preparing-not-frozen'),
  repetitions: z.literal(3),
  seed: z.number().int(),
  budget: z.object({ estimatedCeilingUsd: z.literal(5), admissionStopEstimatedUsd: z.number().positive().max(4) }).passthrough(),
  execution: z.object({
    target: z.literal('recap-agent-runtime-dev'), profile: z.literal('se-dev'),
    region: z.literal('us-east-1'), account: z.literal('684516060775'),
    caseConcurrency: z.literal(1), semanticJudges: z.literal(0),
    allowSemanticRetry: z.literal(false), allowPanelExpansion: z.literal(false),
    productionMutation: z.literal(false),
  }),
  population: z.array(z.object({
    id: z.string().min(1),
    stratum: z.enum(['provider', 'faq_customer_service', 'continuity_auth_effects',
      'july_wedding', 'july_birthday', 'july_baby_shower', 'july_corporate', 'july_social']),
  })).min(30),
  analysis: z.record(z.string(), z.unknown()),
}).superRefine((protocol, context) => {
  if (new Set(protocol.population.map(c => c.id)).size !== protocol.population.length) {
    context.addIssue({ code: 'custom', message: 'Master scenarios must be distinct.' });
  }
  const coreStrata = ['provider', 'faq_customer_service', 'continuity_auth_effects'];
  const julyStrata = ['july_wedding', 'july_birthday', 'july_baby_shower', 'july_corporate', 'july_social'];
  const julyOnly = protocol.population.every(c => julyStrata.includes(c.stratum));
  for (const stratum of julyOnly ? julyStrata : coreStrata) {
    if (protocol.population.filter(c => c.stratum === stratum).length < 10) {
      context.addIssue({ code: 'custom', message: `Expected at least ten scenarios in ${stratum}.` });
    }
  }
});
export type MasterProtocol = z.infer<typeof masterProtocolSchema>;

export function resolveMasterCases(protocol: MasterProtocol, catalog: readonly EvalCase[]): EvalCase[] {
  return protocol.population.map(({ id }) => {
    const current = catalog.find(c => c.id === id);
    if (!current || current.status !== 'active' || !current.targetModes.includes('live_lambda')) {
      throw new Error(`Master case unavailable: ${id}`);
    }
    if (current.suite !== 'live_behavior_regression' || !current.backendFixture?.scenario) {
      throw new Error(`Master case must be mandatory and fixture-backed: ${id}`);
    }
    if (current.inputs.some(input => !input.backendFixture?.scenario)) {
      throw new Error(`Master case needs an explicit fixture on every turn: ${id}`);
    }
    if (current.inputs.some(input => input.channel === 'whatsapp' && !input.contactPhone?.trim())) {
      throw new Error(`WhatsApp master case needs a synthetic contact phone on every turn: ${id}`);
    }
    if (!current.expectations.some(e => e.severity === 'hard') ||
        current.expectations.some(e => e.type === 'text_semantic') ||
        current.scorers.some(s => s.type !== 'expectation_pass_rate')) {
      throw new Error(`Master case needs objective obligations and zero judges: ${id}`);
    }
    return current;
  });
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type MasterAttempt = { index: number; caseId: string; stratum: string; repetition: number };

export function masterSchedule(protocol: MasterProtocol): MasterAttempt[] {
  const random = seededRandom(protocol.seed);
  const schedule: MasterAttempt[] = [];
  for (let repetition = 1; repetition <= protocol.repetitions; repetition += 1) {
    const cases = [...protocol.population];
    for (let i = cases.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [cases[i], cases[j]] = [cases[j], cases[i]];
    }
    for (const current of cases) schedule.push({ index: schedule.length, caseId: current.id, stratum: current.stratum, repetition });
  }
  return schedule;
}

export type SourceFileDigest = { file: string; sha256: string };

export const frozenMasterSchema = z.object({
  studyId: z.string(),
  frozenAt: z.string(),
  protocolPath: z.string(),
  protocol: masterProtocolSchema,
  casesDigest: z.string(),
  sourceFiles: z.array(z.object({ file: z.string(), sha256: z.string() })),
  deployment: z.object({ codeSha256: z.string(), lastModified: z.string(), configurationDigest: z.string() }),
  schedule: z.array(z.object({ index: z.number().int(), caseId: z.string(), stratum: z.string(), repetition: z.number().int() })),
  scriptedTurns: z.number().int().positive(),
  hardAssertions: z.number().int().positive(),
});
export type FrozenMaster = z.infer<typeof frozenMasterSchema>;

export async function describeMasterDeployment(): Promise<FrozenMaster['deployment']> {
  const run = promisify(execFile);
  const env = { ...process.env, AWS_PROFILE: 'se-dev', AWS_REGION: 'us-east-1' };
  const args = ['--profile', 'se-dev', '--region', 'us-east-1', '--output', 'json'];
  const identity = await run('aws', ['sts', 'get-caller-identity', ...args], { env });
  const caller = z.object({ Account: z.literal('684516060775') }).parse(JSON.parse(identity.stdout) as unknown);
  void caller;
  const response = await run('aws', ['lambda', 'get-function-configuration', '--function-name', 'recap-agent-runtime-dev', ...args], { env });
  const config = z.object({
    CodeSha256: z.string(), LastModified: z.string(),
    Environment: z.object({ Variables: z.record(z.string(), z.string()) }),
    MemorySize: z.number(), Timeout: z.number(), Runtime: z.string(),
  }).parse(JSON.parse(response.stdout) as unknown);
  if (config.Environment.Variables.DEPLOYMENT_ENV !== 'development') throw new Error('Master target is not development.');
  if (config.Environment.Variables.AGENT_FEATURE_DECISIONS_ROUTER !== 'true') throw new Error('Master artifact must enable the Decisions router.');
  // Configuration values can contain credentials: retain only their digest.
  return { codeSha256: config.CodeSha256, lastModified: config.LastModified, configurationDigest: digestJson(config) };
}

export async function readFrozenMaster(filename: string, cases: readonly EvalCase[]): Promise<FrozenMaster> {
  const frozen = frozenMasterSchema.parse(JSON.parse(await fs.readFile(filename, 'utf8')) as unknown);
  const expected = resolveMasterCases(frozen.protocol, cases);
  if (masterCasesDigest(expected) !== frozen.casesDigest ||
      digestJson(masterSchedule(frozen.protocol)) !== digestJson(frozen.schedule)) {
    throw new Error('Frozen master cases or schedule changed; no paid dispatch.');
  }
  const files = await masterInputDigests(process.cwd(), frozen.protocolPath);
  if (digestJson(files) !== digestJson(frozen.sourceFiles)) {
    throw new Error('Source, fixture, prompt, evaluator or pricing drift after study freeze; no paid dispatch.');
  }
  return frozen;
}

export async function masterInputDigests(root: string, protocolPath: string): Promise<SourceFileDigest[]> {
  const names: string[] = [protocolPath, 'package.json', 'package-lock.json'];
  async function walk(relative: string): Promise<void> {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Study input symlink not allowed: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) names.push(file);
    }
  }
  for (const directory of ['src', 'prompts', 'knowledge-base', 'evals/cases', 'evals/templates', 'evals/fixtures', 'evals/suites', 'evals/studies']) {
    await walk(directory);
  }
  return Promise.all([...new Set(names)].sort().map(async file => ({
    file, sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex'),
  })));
}

export function masterCasesDigest(cases: readonly EvalCase[]): string {
  return digestJson(cases);
}

export function expandMasterCases(protocol: MasterProtocol, cases: readonly EvalCase[]): EvalCase[] {
  const byId = new Map(cases.map(c => [c.id, c]));
  return masterSchedule(protocol).map(attempt => {
    const current = byId.get(attempt.caseId);
    if (!current) throw new Error(`Missing scheduled master case: ${attempt.caseId}`);
    return { ...current, id: `${current.id}.master_r${attempt.repetition}` };
  });
}

/** Fixed-corpus uncertainty: resample scenarios within strata, retaining repeats. */
export function summarizeMasterResults(protocol: MasterProtocol, outcomes: ReadonlyMap<string, readonly boolean[]>): {
  scheduled: number; observed: number; passed: number; passRate: number;
  allThreePassScenarios: number; mixedScenarios: number;
  scenarioClusterBootstrap95: { lower: number; upper: number; resamples: number; seed: number } | null;
} {
  const samples = protocol.population.map(c => outcomes.get(c.id) ?? []);
  if (samples.some(c => c.length > protocol.repetitions)) throw new Error('Unplanned repeated execution in master results.');
  const observed = samples.reduce((n, c) => n + c.length, 0);
  const passed = samples.reduce((n, c) => n + c.filter(Boolean).length, 0);
  const random = seededRandom(protocol.seed);
  const rates: number[] = [];
  const strata = [...new Set(protocol.population.map(c => c.stratum))];
  for (let draw = 0; draw < 10_000; draw += 1) {
    let successes = 0;
    for (const stratum of strata) {
      const members = protocol.population.filter(c => c.stratum === stratum);
      for (let i = 0; i < members.length; i += 1) {
        const scenario = members[Math.floor(random() * members.length)];
        successes += (outcomes.get(scenario.id) ?? []).filter(Boolean).length;
      }
    }
    rates.push(successes / (protocol.population.length * protocol.repetitions));
  }
  rates.sort((a, b) => a - b);
  return {
    scheduled: protocol.population.length * protocol.repetitions, observed, passed,
    passRate: passed / (protocol.population.length * protocol.repetitions),
    allThreePassScenarios: samples.filter(c => c.length === 3 && c.every(Boolean)).length,
    mixedScenarios: samples.filter(c => c.some(Boolean) && c.some(v => !v)).length,
    scenarioClusterBootstrap95: observed === protocol.population.length * protocol.repetitions
      ? { lower: rates[249], upper: rates[9749], resamples: 10_000, seed: protocol.seed }
      : null,
  };
}
