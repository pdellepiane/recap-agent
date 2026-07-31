# Demonstration guide

This guide covers the request-shape and media-contract demonstration. For the
complete evidence-driven stakeholder demonstration covering all audited fixes,
use [Evidence-driven feedback fixes demonstration](feedback-fixes-demo.md) and
run `AWS_PROFILE=se-dev npm run demo:feedback-fixes`.

## Purpose

This demonstration proves three separate contract guarantees:

1. The existing text-only WhatsApp request remains valid and does not need a
   `media` field.
2. A captionless image can be represented by trusted WhatsApp metadata without
   inventing text or downloading the file.
3. A request cannot be empty: it must contain non-empty text, one or more media
   descriptors, or both.

It also proves the current capability boundary: image metadata is wired through
the runtime, but image retrieval and interpretation are deliberately disabled.

## Preparation

Run from the repository root. The presenter needs:

- Node.js 24 or later;
- network access to the development Function URL;
- `CHANNEL_API_KEY` in the ignored local `.env` file or process environment;
- optionally `AGENT_FUNCTION_URL` when demonstrating another deployment.

Do not display, paste into slides, or share the channel key. The demonstration
script loads it only into the HTTP authorization header and never prints it.

## One-command demonstration

```bash
AWS_PROFILE=se-dev npm run demo:channel-contract
```

The AWS profile is included for consistency with the development environment,
although the script calls the HTTPS endpoint and does not invoke AWS APIs.

The script creates a fresh synthetic WhatsApp identity and runs these scenarios:

| Scenario | Request shape | Expected result |
| --- | --- | --- |
| Existing text request | `text` present; `media` omitted | HTTP `200` and a normal Spanish response |
| Captionless image | `media` present; `text` omitted | HTTP `200`, deterministic limitation, no tools, no model tokens |
| Empty request | both `text` and `media` omitted | HTTP `400` with a field-specific validation issue |

The image descriptor uses a synthetic provider media identifier. The runtime
must not retrieve it. This demonstrates the contract and unsupported-media
behavior, not image understanding.

## Presenter script

Use this wording while showing the output:

1. “The first request is the same text-only shape our adapter already sends.
   Notice that the script omits `media` completely and still receives HTTP
   200. Existing callers are not required to add an empty array.”
2. “The second request contains the WhatsApp media object but no text. It
   carries the provider id, registered Internet media type, and provider
   SHA-256 digest. This proves an image was actually sent; we no longer infer
   that from words such as ‘foto’.”
3. “The response clearly says in Spanish that images cannot be read yet. The
   trace shows the deterministic media path, no tool calls, and no model token
   usage.”
4. “The final request contains neither text nor media and is rejected. Media is
   optional, but content is not.”

## Show the exact request bodies

Existing text-only shape:

```json
{
  "text": "Hola, necesito ayuda para organizar un evento, pero todavía no he decidido qué tipo de evento será",
  "user_id": "whatsapp:51999999999",
  "channel": "whatsapp",
  "contact_phone": "+51999999999",
  "message_id": "demo-text-1",
  "received_at": "2026-07-24T18:00:00.000Z",
  "client_mode": "channel"
}
```

Captionless image shape:

```json
{
  "user_id": "whatsapp:51999999999",
  "channel": "whatsapp",
  "contact_phone": "+51999999999",
  "message_id": "demo-image-1",
  "received_at": "2026-07-24T18:00:05.000Z",
  "media": [
    {
      "type": "image",
      "id": "2754859441498128",
      "mime_type": "image/jpeg",
      "sha256": "81d3bd8a8db4868c9520ed47186e8b7c5789e61ff79f7f834be6950b808a90d3"
    }
  ],
  "client_mode": "channel"
}
```

An image with a caption may include both `text` and `media`. The adapter copies
WhatsApp's native `image.caption` to `text`; `media` remains the authoritative
evidence that an image was sent.

## Optional FAQ wording demonstration

After the contract demonstration, send these messages from a separate synthetic
conversation:

| Input | Point to verify |
| --- | --- |
| `Tengo un problema con un regalo y necesito saber qué pasó con el pago` | The assistant says it can directly help only with event information and offers a person from the team; it does not diagnose the transaction. |
| `El horario` | When the structured extraction is uncertain, the assistant asks which schedule the person means instead of choosing an interpretation. |
| `Te mandé una captura con el código` | A text-only capability question receives the image limitation, but the trace has no media metadata because no image descriptor was sent. |
| `nombre @ejemplo.com` during event verification | Only the unambiguous whitespace around `@` is removed; no other character is invented. |

Do not use a real person's email, phone number, event code, or media identifier
in a public demonstration.

## Evidence after the demonstration

For operational review, correlate the synthetic `message_id` as follows:

- DynamoDB turn-performance records contain `media_count`, `media_kinds`,
  `media_mime_types`, and only hashes of provider media identifiers.
- CloudWatch `channel_request_completed` records contain the same media count,
  class, and provider-id hashes.
- Neither store contains image bytes, a download URL, or provider credentials.

The external Meta webhook adapter is not in this repository. A real WhatsApp
demonstration requires that adapter to copy the native media object into the
documented runtime `media` descriptor.
