import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.development', '.env.local', '.env'], quiet: true });
import { createEmptyPlan, mergePlan } from './src/core/plan';
import { EvalLoader } from './src/evals/loader';
import { DynamoPlanStore } from './src/storage/dynamo-plan-store';

async function main(): Promise<void> {
  const loader = new EvalLoader('./evals');
  const catalog = await loader.loadCatalog();
  const kate = catalog.cases.find((c) => c.id === 'live_behavior.s12_provider_completion_truthful_event_date');
  if (!kate) throw new Error('case missing');
  const functionUrl = 'https://2lmbpyf24mdgri5m7gk2doe4ri0pjdgh.lambda-url.us-east-1.on.aws/';
  const store = new DynamoPlanStore('recap-agent-runtime-dev-plans', { region: 'us-east-1' });
  const channel = 'terminal_whatsapp';
  const externalUserId = `${channel}-probe-s12-${crypto.randomUUID().slice(0, 8)}`;
  await store.save({
    plan: mergePlan(
      createEmptyPlan({ planId: crypto.randomUUID(), channel, externalUserId }),
      kate.seedPlan as Record<string, unknown>,
    ),
    reason: 'eval-seed',
  });
  const input = kate.inputs[0] as { text: string; sessionId?: string; contactPhone?: string | null; channel?: string };
  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DEV_CHANNEL_API_KEY}` },
    body: JSON.stringify({
      channel: input.channel ?? channel,
      user_id: externalUserId,
      text: input.text,
      message_id: 'probe-s12-0',
      received_at: new Date().toISOString(),
      session_id: input.sessionId ?? 'probe-s12',
      contact_phone: input.contactPhone ?? '+51999111222',
      client_mode: 'cli',
      backendFixture: { scenario: 's12-provider-completion' },
    }),
    signal: AbortSignal.timeout(95000),
  });
  const raw = (await res.json()) as { reply?: string; trace?: { tools_called?: string[]; tool_inputs?: Array<{ tool: string; input: string }>; tool_outputs?: Array<{ tool: string; output: string }> } };
  console.log('HTTP', res.status);
  console.log('KEYS:', Object.keys(raw)); console.log('REPLY:', (raw as Record<string, unknown>).reply ?? (raw as Record<string, unknown>).response ?? JSON.stringify(raw).slice(0,300));
  for (const t of raw.trace?.tools_called ?? []) console.log('CALLED:', t);
  for (const i of raw.trace?.tool_inputs ?? []) {
    if (i.tool === 'finish_plan') console.log('FINISH_PLAN INPUT:', i.input);
  }
  for (const o of raw.trace?.tool_outputs ?? []) {
    if (o.tool === 'finish_plan') console.log('FINISH_PLAN OUTPUT:', String(o.output).slice(0, 1500));
  }
}

void main();
