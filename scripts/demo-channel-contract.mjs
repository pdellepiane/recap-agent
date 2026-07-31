import 'dotenv/config';

const functionUrl =
  process.env.AGENT_FUNCTION_URL ??
  'https://jwtjjociscvaa5dsrp5gokmno40doiva.lambda-url.us-east-1.on.aws/';
const channelApiKey = process.env.CHANNEL_API_KEY;

if (!channelApiKey) {
  throw new Error('CHANNEL_API_KEY is required in the environment or local .env file.');
}

const runId = Date.now().toString(36);
const phone = `+519${String(Date.now()).slice(-8)}`;
const identity = `whatsapp:${phone.slice(1)}`;
const common = {
  user_id: identity,
  channel: 'whatsapp_sandbox',
  contact_phone: phone,
  received_at: new Date().toISOString(),
  client_mode: 'cli',
};

console.log('Channel contract demonstration');
console.log(`Endpoint: ${functionUrl}`);
console.log('The bearer credential is loaded but never printed.');

const legacyPayload = {
  ...common,
  text: 'Hola, necesito ayuda para organizar un evento, pero todavía no he decidido qué tipo de evento será',
  message_id: `demo-legacy-text-${runId}`,
};
assert(!Object.hasOwn(legacyPayload, 'media'), 'Legacy payload must omit media.');
const legacy = await send(legacyPayload);
assert(legacy.status === 200, `Legacy text request returned HTTP ${legacy.status}.`);
assert(typeof legacy.body.message === 'string', 'Legacy text request did not return a message.');

printScenario('1. Existing text-only request remains valid', {
  http_status: legacy.status,
  media_field_sent: false,
  current_node: legacy.body.current_node,
  message: legacy.body.message,
});

const imagePayload = {
  ...common,
  message_id: `demo-image-${runId}`,
  media: [
    {
      type: 'image',
      id: `demo-provider-media-${runId}`,
      mime_type: 'image/jpeg',
      sha256: '81d3bd8a8db4868c9520ed47186e8b7c5789e61ff79f7f834be6950b808a90d3',
    },
  ],
};
assert(!Object.hasOwn(imagePayload, 'text'), 'Captionless image payload must omit text.');
const image = await send(imagePayload);
assert(image.status === 200, `Image request returned HTTP ${image.status}.`);
assert(
  image.body.trace?.prompt_bundle_id === 'deterministic:unsupported_image_media',
  'Image request did not take the deterministic unsupported-media path.',
);
assert(
  image.body.trace?.token_usage?.total === null,
  'Image request unexpectedly used model tokens.',
);
assert(
  Array.isArray(image.body.trace?.tools_called) &&
    image.body.trace.tools_called.length === 0,
  'Image request unexpectedly called a tool.',
);

printScenario('2. Captionless image metadata is accepted without image interpretation', {
  http_status: image.status,
  text_field_sent: false,
  media_type_sent: imagePayload.media[0].mime_type,
  current_node: image.body.current_node,
  prompt_bundle_id: image.body.trace.prompt_bundle_id,
  model_tokens: image.body.trace.token_usage.total,
  tools_called: image.body.trace.tools_called,
  message: image.body.message,
});

const empty = await send({
  ...common,
  message_id: `demo-empty-${runId}`,
});
assert(empty.status === 400, `Empty request should return HTTP 400, received ${empty.status}.`);

printScenario('3. A request still needs text, media, or both', {
  http_status: empty.status,
  expected_status: 400,
  validation_issues: empty.body.issues,
});

console.log('\nDemonstration passed.');

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

function printScenario(title, value) {
  console.log(`\n${title}`);
  console.log(JSON.stringify(value, null, 2));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
