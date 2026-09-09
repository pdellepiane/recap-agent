import crypto from 'node:crypto';
import OpenAI from 'openai';

import { redactArtifactText } from '../../runtime/artifact-redaction';

export type SemanticJudgeOutcome = {
  skipped: boolean;
  score: number;
  message: string;
  requestHash?: string;
  rubricDigest?: string;
  evidenceDigest?: string;
};

export function hashJudgePayload(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function evaluateSemanticJudgeOutcome(args: {
  outcome: SemanticJudgeOutcome;
  minScore: number;
  requireJudge: boolean;
}): { passed: boolean; score: number } {
  if (args.outcome.skipped) {
    return {
      passed: !args.requireJudge,
      score: args.requireJudge ? 0 : 1,
    };
  }

  return {
    passed: args.outcome.score >= args.minScore,
    score: args.outcome.score,
  };
}

export async function runSemanticJudge(args: {
  apiKey: string | null;
  model: string;
  rubric: string;
  candidateText: string;
  context?: string;
  evidenceDigest?: string;
  client?: OpenAI;
}): Promise<SemanticJudgeOutcome> {
  const redactedCandidate = redactArtifactText(args.candidateText);
  const redactedContext = args.context ?? '';
  const serializedRequest = JSON.stringify({
    model: args.model,
    rubric: args.rubric,
    candidateText: redactedCandidate,
    context: redactedContext,
    evidenceDigest: args.evidenceDigest ?? '',
  });
  const requestHash = hashJudgePayload(serializedRequest);
  const rubricDigest = hashJudgePayload(args.rubric);
  const evidenceDigest = hashJudgePayload(redactedCandidate + '\n' + redactedContext + '\n' + (args.evidenceDigest ?? ''));
  if (!args.apiKey) {
    return {
      skipped: true,
      score: 0,
      message: `Skipped semantic judge because OPENAI_API_KEY is not available. requestHash=${requestHash} rubricDigest=${rubricDigest} evidenceDigest=${evidenceDigest}`,
      requestHash,
      rubricDigest,
      evidenceDigest,
    };
  }

  const client = args.client ?? new OpenAI({ apiKey: args.apiKey });
  const completion = await client.chat.completions.create({
    model: args.model,
    messages: [
      {
        role: 'system',
        content:
          'You are an evaluation judge. Return only JSON with keys "score" and "reason". Score must be a number from 0 to 1.',
      },
      {
        role: 'user',
        content: [
          `Rubric:\n${args.rubric}`,
          args.context
            ? `Interaction context:\n${redactedContext}`
            : null,
          `Candidate response:\n${redactedCandidate}`,
        ].filter((section): section is string => section !== null).join('\n\n'),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  if (raw.length === 0) throw new Error(`Judge returned missing response. requestHash=${requestHash}`);
  const parsed = parseStrictJudgeJson(raw, requestHash);

  return {
    skipped: false,
    score: parsed.score,
    message: `${parsed.reason} requestHash=${requestHash} rubricDigest=${rubricDigest} evidenceDigest=${evidenceDigest}`,
    requestHash,
    rubricDigest,
    evidenceDigest,
  };
}

function parseStrictJudgeJson(raw: string, requestHash: string): { score: number; reason: string } {
  const match = raw.match(/\{[\s\S]*\}/u);
  if (!match) throw new Error(`Judge returned malformed JSON. requestHash=${requestHash}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]) as unknown;
  } catch {
    throw new Error(`Judge returned malformed JSON. requestHash=${requestHash}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Judge returned malformed JSON. requestHash=${requestHash}`);
  }
  const record = parsed as Record<string, unknown>;
  const score = record['score'];
  const reason = record['reason'];
  if (typeof score !== 'number' || Number.isNaN(score) || score < 0 || score > 1) {
    throw new Error(`Judge returned malformed score. requestHash=${requestHash}`);
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error(`Judge returned malformed reason. requestHash=${requestHash}`);
  }
  return { score: Math.max(0, Math.min(1, score)), reason: reason.trim() };
}
