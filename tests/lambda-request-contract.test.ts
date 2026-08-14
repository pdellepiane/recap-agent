import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  agentParticipationRequestSchema,
  channelRequestSchema,
} from '../src/lambda/request-contract';

describe('Lambda channel request contract', () => {
  it('publishes the media descriptor as JSON Schema Draft 2020-12', () => {
    const schema = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), 'docs/contracts/channel-media.schema.json'),
      'utf8',
    )) as {
      $schema?: string;
      required?: string[];
      properties?: {
        type?: { enum?: string[] };
      };
    };

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.required).toEqual(['type', 'id', 'mime_type', 'sha256']);
    expect(schema.properties?.type?.enum).toEqual([
      'image',
      'video',
      'audio',
      'document',
      'sticker',
    ]);
  });

  it('keeps the historical text-only WhatsApp request valid without media or message_id', () => {
    const result = channelRequestSchema.safeParse({
      text: 'Necesito catering',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '+51999999999',
      received_at: '2026-07-14T15:00:00.000Z',
      client_mode: 'channel',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.media).toEqual([]);
      expect(result.data.text).toBe('Necesito catering');
      expect(result.data.message_id).toBeUndefined();
    }
  });

  it('accepts a captionless WhatsApp image using the native media descriptor fields', () => {
    const result = channelRequestSchema.safeParse({
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '+51999999999',
      message_id: 'wamid.image-123',
      media: [
        {
          type: 'image',
          id: '2754859441498128',
          mime_type: 'image/jpeg',
          sha256: '81d3bd8a8db4868c9520ed47186e8b7c5789e61ff79f7f834be6950b808a90d3',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('');
      expect(result.data.media[0]).toMatchObject({
        type: 'image',
        id: '2754859441498128',
        mime_type: 'image/jpeg',
      });
    }
  });

  it('accepts text and media together for a captioned WhatsApp image', () => {
    const result = channelRequestSchema.safeParse({
      text: 'Este es el dato que aparece en la imagen',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '+51999999999',
      message_id: 'wamid.captioned-image-123',
      media: [
        {
          type: 'image',
          id: '2754859441498128',
          mime_type: 'image/jpeg',
          sha256: '81d3bd8a8db4868c9520ed47186e8b7c5789e61ff79f7f834be6950b808a90d3',
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects a request without text or media', () => {
    const result = channelRequestSchema.safeParse({
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '+51999999999',
    });

    expect(result.success).toBe(false);
  });

  it('rejects image metadata whose registered media type does not describe an image', () => {
    const result = channelRequestSchema.safeParse({
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '+51999999999',
      media: [
        {
          type: 'image',
          id: '2754859441498128',
          mime_type: 'application/pdf',
          sha256: '81d3bd8a8db4868c9520ed47186e8b7c5789e61ff79f7f834be6950b808a90d3',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects WhatsApp requests without phone context', () => {
    const result = channelRequestSchema.safeParse({
      text: 'Necesito catering',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed phone context instead of silently dropping it', () => {
    const result = channelRequestSchema.safeParse({
      text: 'Necesito catering',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '999999999',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a conversation ownership request', () => {
    const result = agentParticipationRequestSchema.safeParse({
      channel: 'whatsapp',
      user_id: 'whatsapp:51999999999',
      request_id: 'ownership-request-123',
      requested_at: '2026-07-15T20:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a conversation ownership request without correlation identity', () => {
    const result = agentParticipationRequestSchema.safeParse({
      channel: 'whatsapp',
      user_id: 'whatsapp:51999999999',
    });
    expect(result.success).toBe(false);
  });
});
