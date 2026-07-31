import 'dotenv/config';

const functionUrl =
  process.env.AGENT_FUNCTION_URL ??
  'https://jwtjjociscvaa5dsrp5gokmno40doiva.lambda-url.us-east-1.on.aws/';
const channelApiKey = process.env.CHANNEL_API_KEY;

if (!channelApiKey) {
  throw new Error('CHANNEL_API_KEY is required in the environment or local .env file.');
}

const runId = Date.now().toString(36);
let scenarioIndex = 0;

console.log('Evidence-driven feedback fixes demonstration');
console.log(`Endpoint: ${functionUrl}`);
console.log('The bearer credential is loaded but never printed.');

const transaction = await runTextScenario(
  'capability_boundary',
  'Tengo un problema con un regalo y necesito saber qué pasó con el pago',
);
assert(transaction.status === 200, 'Capability-boundary request failed.');
assertIncludes(transaction.body.message, 'información de tu evento');
assertIncludes(transaction.body.message, 'persona');
assertSpanishPolicyClean(transaction.body, 'Capability-boundary response');

printCategory({
  category: 'Unsupported gifts, sales, and payments',
  evidence:
    '24 of 35 retained question turns concerned transactions even though no transactional tool exists.',
  fix:
    'State the event-information-only boundary and offer a person from the team without diagnosing the operation.',
  demo_input: 'Tengo un problema con un regalo y necesito saber qué pasó con el pago',
  response: transaction.body.message,
  feedback_signals: selectSignals(transaction.body),
});

const ambiguity = await runTextScenario('ambiguous_schedule', 'El horario');
assert(ambiguity.status === 200, 'Ambiguity request failed.');
assert(
  ambiguity.body.perf?.feedback_signals?.routing?.ambiguity_status === 'ambiguous',
  'The extractor did not emit explicit structured ambiguity evidence.',
);
assert(
  ambiguity.body.perf?.feedback_signals?.output?.question_count === 1,
  'Ambiguity response must contain one clarification question.',
);
assertIncludes(ambiguity.body.message, ' o ');
assertSpanishPolicyClean(ambiguity.body, 'Ambiguity response');

printCategory({
  category: 'Ambiguous short fragments',
  evidence:
    'The live fragment “El horario” was previously interpreted as business hours instead of being clarified.',
  fix:
    'Use an explicit typed ambiguity decision and validate that the final response is one short clarification question.',
  demo_input: 'El horario',
  response: ambiguity.body.message,
  feedback_signals: selectSignals(ambiguity.body),
});

const emailLocalPart = `demo.${runId}`;
const spacedEmail = `${emailLocalPart} @example.com`;
const normalizedEmail = `${emailLocalPart}@example.com`;
const verification = await runTextScenario(
  'verification_guidance',
  `Quiero consultar la información de un evento. Mi correo es ${spacedEmail}`,
);
assert(verification.status === 200, 'Verification-guidance request failed.');
assert(
  verification.body.plan?.contact_email === normalizedEmail,
  'The unambiguous email space was not normalized as expected.',
);
assertIncludes(verification.body.message, 'correo');
assertIncludes(verification.body.message, 'código');
assertIncludes(verification.body.message, 'no puedo leer');
assertSpanishPolicyClean(verification.body, 'Verification response');

printCategory({
  category: 'Verification guidance and conservative email repair',
  evidence:
    'Live users needed the code purpose, location, and image limitation explained; obvious whitespace around @ was recoverable.',
  fix:
    'Remove only whitespace adjacent to @, explain why the code is needed and where to find it, and require the code as typed text.',
  demo_input: `Mi correo es ${spacedEmail}`,
  normalized_email: normalizedEmail,
  response: verification.body.message,
  feedback_signals: selectSignals(verification.body),
});

const imageCommon = nextCommon('actual_image');
const image = await send({
  ...imageCommon,
  message_id: `demo-feedback-image-${runId}`,
  media: [
    {
      type: 'image',
      id: `demo-feedback-media-${runId}`,
      mime_type: 'image/jpeg',
      sha256: '81d3bd8a8db4868c9520ed47186e8b7c5789e61ff79f7f834be6950b808a90d3',
    },
  ],
});
assert(image.status === 200, 'Image request failed.');
assert(
  image.body.perf?.feedback_signals?.input?.shape === 'media_only',
  'Image request was not recorded as media_only.',
);
assert(
  image.body.perf?.feedback_signals?.routing?.decision_source === 'deterministic',
  'Image request did not use deterministic routing.',
);
assert(
  image.body.perf?.feedback_signals?.execution?.model_call_count === 0,
  'Image request unexpectedly used a model.',
);
assertSpanishPolicyClean(image.body, 'Image response');

printCategory({
  category: 'Actual image presence',
  evidence:
    'Text mentioning a photograph could not prove that WhatsApp delivered media.',
  fix:
    'Carry the native media descriptor and use it as trusted evidence while image interpretation remains disabled.',
  demo_input: {
    text_field_sent: false,
    media_type: 'image/jpeg',
  },
  response: image.body.message,
  feedback_signals: selectSignals(image.body),
});

printCategory({
  category: 'Duplicate messages and multi-message bursts',
  evidence:
    'Ten duplicate native message-id groups represented 28.6% excess retained question records, and split thoughts were processed independently.',
  fix:
    'The design retains individual messages temporarily for replay, deduplicates native ids, and seals ordered bursts before one runtime turn.',
  status:
    'Designed and documented, but adapter burst persistence and idempotency are not implemented yet.',
});

printCategory({
  category: 'Richer feedback evidence',
  evidence:
    'Existing quality flags missed unsupported claims, ambiguity, duplicate correlation, response complexity, and language-policy leakage.',
  fix:
    'Persist versioned safe feedback signals per turn and expose their summary in CloudWatch.',
  status: 'Implemented in the runtime trace contract.',
  saved_signals: {
    correlation: 'hashed message and session identifiers',
    input: 'shape, timing, text/media counts, and trusted context presence',
    routing: 'intent confidence, route, deterministic/model source, and FAQ state',
    execution: 'model stages, tools, file search, and latency',
    output: 'length, words, questions, links, list items, quality flags, and Spanish-policy term hits',
    excluded: 'raw messages, raw media, provider media ids, URLs, and credentials',
  },
});

console.log('\nAll deployed demonstration scenarios passed.');

async function runTextScenario(label, text) {
  const common = nextCommon(label);
  const payload = {
    ...common,
    text,
    message_id: `demo-feedback-${label}-${runId}`,
  };
  assert(!Object.hasOwn(payload, 'media'), `${label} must omit optional media.`);
  return await send(payload);
}

function nextCommon(label) {
  scenarioIndex += 1;
  const phoneDigits = String((Number(String(Date.now()).slice(-8)) + scenarioIndex) % 100_000_000)
    .padStart(8, '0');
  const phone = `+519${phoneDigits}`;
  return {
    user_id: `whatsapp:${phone.slice(1)}`,
    channel: 'whatsapp_sandbox',
    contact_phone: phone,
    received_at: new Date().toISOString(),
    session_id: `demo-feedback-session-${label}-${runId}`,
    client_mode: 'cli',
  };
}

async function send(payload) {
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${channelApiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  return { status: response.status, body };
}

function selectSignals(body) {
  const signals = body.perf?.feedback_signals;
  assert(signals?.schema_version === 1, 'feedback_signals schema version 1 is missing.');
  return {
    trace_id: body.trace?.trace_id,
    correlation: signals.correlation,
    input: signals.input,
    routing: signals.routing,
    execution: signals.execution,
    output: signals.output,
    storage_boundaries: signals.storage_boundaries,
  };
}

function assertSpanishPolicyClean(body, label) {
  const hits = body.perf?.feedback_signals?.output?.spanish_policy_term_hits;
  assert(Array.isArray(hits), `${label} is missing Spanish-policy feedback signals.`);
  assert(hits.length === 0, `${label} contains banned service terms: ${hits.join(', ')}`);
}

function assertIncludes(value, expected) {
  assert(
    typeof value === 'string' && value.toLocaleLowerCase('es').includes(expected),
    `Expected response to include “${expected}”.`,
  );
}

function printCategory(value) {
  console.log('\n' + JSON.stringify(value, null, 2));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
