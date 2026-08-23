#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

import { createEmptyPlan } from '../src/core/plan';
import { OpenAiMessageResponseClassifier } from '../src/runtime/message-response-classifier';
import { DEFAULT_GPT_TEXT_MODEL } from '../src/runtime/openai-model-defaults';
import { PromptLoader } from '../src/runtime/prompt-loader';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const recordSchema = z.object({
  id: z.string().min(1),
  campaign: z.string().min(1),
  inbound: z.string().min(1),
  expected_action: z.enum([
    'respond',
    'suppress_acknowledgement',
    'suppress_reaction',
  ]),
  expected_kind: z.enum([
    'rsvp_decision',
    'declines_campaign_offer',
    'acknowledgement_only',
    'reaction_only',
    'question_or_request',
    'other_actionable',
    'unclear',
  ]),
});

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for the live classifier evaluation.');
  }

  const corpusPath = path.resolve(
    process.cwd(),
    'evals/classifiers/campaign-reply-realistic.jsonl',
  );
  const records = (await fs.readFile(corpusPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => recordSchema.parse(JSON.parse(line) as unknown));
  const classifier = new OpenAiMessageResponseClassifier({
    apiKey,
    model: process.env.OPENAI_RESPONSE_CLASSIFIER_MODEL ?? DEFAULT_GPT_TEXT_MODEL,
    mode: 'enforce',
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    timeoutMs: Number(process.env.OPENAI_RESPONSE_CLASSIFIER_TIMEOUT_MS ?? 16_000),
  });
  const repetitions = Number(process.env.CLASSIFIER_EVAL_REPETITIONS ?? 3);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
    throw new Error('CLASSIFIER_EVAL_REPETITIONS must be an integer from 1 to 10.');
  }

  const results = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const [index, record] of records.entries()) {
      const plan = createEmptyPlan({
        planId: `classifier-live-${record.id}-${repetition}`,
        channel: 'whatsapp',
        externalUserId: `classifier-fixture-${index + 1}`,
      });
      const result = await classifier.classify({
        inboundText: record.inbound,
        plan,
        messages: [{
          id: 1,
          direction: 'outbound',
          source: 'admin_campaign',
          body: record.campaign,
          status: 'sent',
          sentAt: null,
          createdAt: null,
        }],
        contextSource: 'agent_api',
      });
      const passed =
        result.trace.action === record.expected_action &&
        result.trace.campaign_reply_kind === record.expected_kind &&
        result.trace.classifier_profile === 'campaign_reply';
      results.push({
        id: record.id,
        repetition,
        passed,
        expected_action: record.expected_action,
        actual_action: result.trace.action,
        expected_kind: record.expected_kind,
        actual_kind: result.trace.campaign_reply_kind,
        fallback_used: result.trace.fallback_used,
        instruction_bytes: result.openAiCall?.requestMetrics.instructionBytes ?? null,
        input_bytes: result.openAiCall?.requestMetrics.inputBytes ?? null,
      });
    }
  }

  const failed = results.filter((result) => !result.passed);
  process.stdout.write(`${JSON.stringify({
    cases: records.length,
    repetitions,
    total_attempts: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  }, null, 2)}\n`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
