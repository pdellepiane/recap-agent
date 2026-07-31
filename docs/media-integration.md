# Channel media integration

## Current capability boundary

The channel contract carries complete provider-hosted media metadata through the
Lambda request and into the channel-agnostic runtime. The runtime does not yet
retrieve, decode, inspect, transcribe, or otherwise interpret media.

When an inbound turn includes an image descriptor, the runtime relies on that
trusted channel evidence and returns:

> Por ahora no puedo leer imágenes. Escribe aquí el dato que aparece y podré orientarte

This is a deterministic response. It does not ask the language model to infer
whether the user sent an image from words such as "foto" or "captura".

## Standards and source format

The descriptor is documented by
[`docs/contracts/channel-media.schema.json`](contracts/channel-media.schema.json),
using [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12).

`mime_type` is an Internet media type following
[RFC 6838](https://www.rfc-editor.org/rfc/rfc6838) and the
[IANA media type registry](https://www.iana.org/assignments/media-types/media-types.xhtml).
For example, a JPEG image uses `image/jpeg`.

The WhatsApp mapping follows Meta's official webhook shape. Meta's
[received-image example](https://www.postman.com/meta/whatsapp-business-platform/request/dy46yyn/received-media-message-with-image)
contains `image.id`, `image.mime_type`, `image.sha256`, and an optional
`image.caption`. Meta's
[media retrieval documentation](https://www.postman.com/meta/whatsapp-business-platform/request/fpj02x0/retrieve-media-url)
defines the media identifier as the handle used by the Graph API media
retrieval path.

## Runtime request shape

The `media` field is an array so the contract does not need to change when the
adapter later groups a short message burst containing more than one media
message.

```json
{
  "text": "",
  "user_id": "whatsapp:51999999999",
  "channel": "whatsapp",
  "contact_phone": "+51999999999",
  "message_id": "wamid.HBg...",
  "received_at": "2026-07-24T18:00:00.000Z",
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

The fields are:

| Field | Meaning |
| --- | --- |
| `type` | Native media class: `image`, `video`, `audio`, `document`, or `sticker`. |
| `id` | Opaque provider media identifier. For WhatsApp, copy the native media object's `id` exactly. |
| `mime_type` | Registered Internet media type copied from the native `mime_type`. |
| `sha256` | Sixty-four-character hexadecimal SHA-256 digest copied from the native object. |
| `filename` | Optional provider filename, normally for a document. |

`text` contains the native caption when one exists. It is an empty string or
may be omitted when the image has no caption. A request must contain non-empty
text, at least one valid media descriptor, or both.

## WhatsApp adapter mapping

```ts
const nativeMedia = message.image;

const request = {
  channel: 'whatsapp',
  user_id: `whatsapp:${from}`,
  contact_phone: `+${from}`,
  text: nativeMedia.caption?.trim() ?? '',
  message_id: message.id,
  received_at: new Date(Number(message.timestamp) * 1000).toISOString(),
  media: [
    {
      type: message.type,
      id: nativeMedia.id,
      mime_type: nativeMedia.mime_type,
      sha256: nativeMedia.sha256,
    },
  ],
  client_mode: 'channel' as const,
};
```

The adapter must validate the full request before forwarding it. It must not
place a Graph API access token, media download URL, base64 payload, data URL, or
raw media bytes in the runtime request.

## Persistence and observability

The durable turn-performance record stores only:

- media item count;
- media classes;
- Internet media types;
- SHA-256 hashes of provider media identifiers.

The CloudWatch completion record stores the count, distinct media classes, and
hashed provider media identifiers. It does not store the provider media
identifier, filename, caption, media URL, digest supplied for the media body, or
media bytes. The message text follows the existing preview and redaction rules.

The message burst design retains one descriptor with each individual message so
future replay can reconstruct which turns actually contained media. This
evidence is retained to reproduce misunderstandings and improve wording; it is
not an image archive.

## Future media interpretation

Adding media interpretation later requires a channel-owned resolver:

1. Accept the validated opaque media identifier.
2. Retrieve a short-lived media URL from the provider using server-side
   credentials.
3. Download the content with strict byte, time, redirect, and registered-media-
   type limits.
4. Verify the downloaded bytes against the provider SHA-256 digest.
5. Pass the verified content to a media-capable service.
6. Delete temporary bytes and persist only the minimum derived result allowed by
   the product's retention policy.

Until that resolver exists, the runtime deliberately never calls the provider
media endpoint.
