import OpenAI from 'openai';

export type SemanticJudgeOutcome = {
  skipped: boolean;
  score: number;
  message: string;
};

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
  client?: OpenAI;
}): Promise<SemanticJudgeOutcome> {
  if (!args.apiKey) {
    return {
      skipped: true,
      score: 0,
      message: 'Skipped semantic judge because OPENAI_API_KEY is not available.',
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
          args.context ? `Interaction context:\n${args.context}` : null,
          `Candidate response:\n${args.candidateText}`,
        ].filter((section): section is string => section !== null).join('\n\n'),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    score?: number;
    reason?: string;
  };

  return {
    skipped: false,
    score: clamp(parsed.score ?? 0),
    message: parsed.reason ?? 'Semantic judge completed without a reason.',
  };
}

function extractJsonObject(value: string): string {
  const match = value.match(/\{[\s\S]*\}/u);
  return match?.[0] ?? '{"score":0,"reason":"Judge output was not valid JSON."}';
}

function clamp(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
