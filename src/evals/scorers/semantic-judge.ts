import OpenAI from 'openai';

export type SemanticJudgeOutcome = {
  skipped: boolean;
  score: number;
  message: string;
};

export async function runSemanticJudge(args: {
  apiKey: string | null;
  model: string;
  rubric: string;
  candidateText: string;
}): Promise<SemanticJudgeOutcome> {
  if (!args.apiKey) {
    return {
      skipped: true,
      score: 0,
      message: 'Skipped semantic judge because OPENAI_API_KEY is not available.',
    };
  }

  const client = new OpenAI({ apiKey: args.apiKey });
  const completion = await client.chat.completions.create({
    model: args.model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are an evaluation judge. Return only JSON with keys "score" and "reason". Score must be a number from 0 to 1.',
      },
      {
        role: 'user',
        content: `Rubric:\n${args.rubric}\n\nCandidate:\n${args.candidateText}`,
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
