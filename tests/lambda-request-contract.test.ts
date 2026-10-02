import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  agentParticipationRequestSchema,
  backendFixtureSchema,
  channelRequestSchema,
} from '../src/lambda/request-contract';

describe('Lambda channel request contract', () => {
  it('rejects ambiguous channel key components but preserves user identifiers', () => {
    expect(channelRequestSchema.safeParse({
      channel: 'terminal#other', user_id: 'user', text: 'Hola',
    }).success).toBe(false);
    expect(agentParticipationRequestSchema.safeParse({
      channel: 'terminal#other', user_id: 'user', request_id: 'request',
    }).success).toBe(false);
    expect(channelRequestSchema.parse({
      channel: 'terminal', user_id: 'other#user', text: 'Hola',
    }).user_id).toBe('other#user');
  });

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

  it('accepts WhatsApp images with or without a caption', () => {
    const captionless = channelRequestSchema.safeParse({
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

    expect(captionless.success).toBe(true);
    if (captionless.success) {
      expect(captionless.data.text).toBe('');
      expect(captionless.data.media[0]).toMatchObject({
        type: 'image',
        id: '2754859441498128',
        mime_type: 'image/jpeg',
      });
    }

    const captioned = channelRequestSchema.safeParse({
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

    expect(captioned.success).toBe(true);
  });

  it('rejects malformed channel requests', () => {
    expect(channelRequestSchema.safeParse({
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '+51999999999',
    }).success).toBe(false);

    expect(channelRequestSchema.safeParse({
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
    }).success).toBe(false);

    expect(channelRequestSchema.safeParse({
      text: 'Necesito catering',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
    }).success).toBe(false);

    expect(channelRequestSchema.safeParse({
      text: 'Necesito catering',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '999999999',
    }).success).toBe(false);

    expect(channelRequestSchema.safeParse({
      user_id: 'whatsapp:+51987654321',
      channel: 'whatsapp',
      contact_phone: '+51987654321',
      message_id: 'wamid.ambiguous-image',
      text: null,
      image: {
        data: 'iVBORw0KGgoAAAANSUhEUgAA',
        error: 'media_unavailable',
        mime_type: 'image/jpeg',
      },
    }).success).toBe(false);
  });

  it.each([
    '+51900000689',
    '+525512345678',
    '+12025550100',
    '+96170197268',
    '+44900000689',
  ])('accepts a trusted international phone on an explicit decline: %s', (contactPhone) => {
    const result = channelRequestSchema.safeParse({
      text: 'Lamentablemente, no podré asistir. Ya le envié un mensaje a Paula.',
      user_id: `whatsapp:${contactPhone}`,
      channel: 'whatsapp',
      contact_phone: contactPhone,
      message_id: 'wamid.synthetic-decline',
      client_mode: 'channel',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contact_phone).toBe(contactPhone);
      expect(result.data.message_id).toBe('wamid.synthetic-decline');
    }
  });

  it.each([
    '900000689',
    '+5190000068',
    '+519000006890',
    '+9991234567',
    '+51 (900) unknown',
  ])('rejects an untrusted or ambiguous phone before decline processing: %s', (contactPhone) => {
    const result = channelRequestSchema.safeParse({
      text: 'No podré asistir.',
      user_id: 'whatsapp:unverified',
      channel: 'whatsapp',
      contact_phone: contactPhone,
      message_id: 'wamid.synthetic-decline',
    });
    expect(result.success).toBe(false);
  });

  it('accepts backend image payloads, error events, and captions', () => {
    const payload = channelRequestSchema.safeParse({
      user_id: 'whatsapp:+51987654321',
      channel: 'whatsapp',
      contact_phone: '+51987654321',
      message_id: 'wamid.HBgLNTE5ODc2NTQzMjE',
      received_at: '2026-09-08T14:30:00Z',
      client_mode: 'channel',
      text: null,
      image: {
        data: 'iVBORw0KGgoAAAANSUhEUgAA',
        mime_type: 'image/jpeg',
      },
    });

    expect(payload.success).toBe(true);
    if (payload.success) {
      expect(payload.data.text).toBe('');
      expect(payload.data.image).toMatchObject({ mime_type: 'image/jpeg' });
    }

    const captioned = channelRequestSchema.safeParse({
      user_id: 'whatsapp:+51987654321',
      channel: 'whatsapp',
      contact_phone: '+51987654321',
      message_id: 'wamid.captioned-backend-image',
      received_at: '2026-09-08T14:30:00Z',
      client_mode: 'channel',
      text: 'Este es mi comprobante',
      image: {
        data: 'iVBORw0KGgoAAAANSUhEUgAA',
        mime_type: 'image/jpeg',
      },
    });

    expect(captioned.success).toBe(true);
    if (captioned.success) {
      expect(captioned.data.text).toBe('Este es mi comprobante');
      expect(captioned.data.image).toMatchObject({ mime_type: 'image/jpeg' });
    }

    const tooLarge = channelRequestSchema.safeParse({
      user_id: 'whatsapp:+51987654321',
      channel: 'whatsapp',
      contact_phone: '+51987654321',
      message_id: 'wamid.too-large-image',
      received_at: '2026-09-08T14:30:00Z',
      client_mode: 'channel',
      text: null,
      image: {
        error: 'image_too_large',
        mime_type: 'image/jpeg',
      },
    });

    expect(tooLarge.success).toBe(true);
    if (tooLarge.success) {
      expect(tooLarge.data.text).toBe('');
      expect(tooLarge.data.image).toMatchObject({ error: 'image_too_large' });
    }

    expect(channelRequestSchema.safeParse({
      user_id: 'whatsapp:+51987654321',
      channel: 'whatsapp',
      contact_phone: '+51987654321',
      message_id: 'wamid.unavailable-image',
      received_at: '2026-09-08T14:30:00Z',
      client_mode: 'channel',
      text: null,
      image: {
        error: 'media_unavailable',
        mime_type: 'image/jpeg',
      },
    }).success).toBe(true);

    const captionedError = channelRequestSchema.safeParse({
      user_id: 'whatsapp:+51987654321',
      channel: 'whatsapp',
      contact_phone: '+51987654321',
      message_id: 'wamid.captioned-error-image',
      received_at: '2026-09-08T14:30:00Z',
      client_mode: 'channel',
      text: 'No se ve bien?',
      image: {
        error: 'media_unavailable',
        mime_type: 'image/jpeg',
      },
    });

    expect(captionedError.success).toBe(true);
    if (captionedError.success) {
      expect(captionedError.data.text).toBe('No se ve bien?');
    }
  });

  it('validates conversation ownership requests by correlation identity', () => {
    expect(agentParticipationRequestSchema.safeParse({
      channel: 'whatsapp',
      user_id: 'whatsapp:51999999999',
      request_id: 'ownership-request-123',
      requested_at: '2026-07-15T20:00:00.000Z',
    }).success).toBe(true);
    expect(agentParticipationRequestSchema.safeParse({
      channel: 'whatsapp',
      user_id: 'whatsapp:51999999999',
    }).success).toBe(false);
  });

  it('requires a complete evaluation identity on the development fixture marker', () => {
    expect(backendFixtureSchema.safeParse({
      scenario: 'image-clean-world', runId: 'run-1', caseId: 'live_behavior.case',
    }).success).toBe(true);
    expect(backendFixtureSchema.safeParse({ scenario: 'image-clean-world' }).success).toBe(false);
    expect(backendFixtureSchema.safeParse({
      scenario: 'image-clean-world', runId: 'run-1',
    }).success).toBe(false);
    expect(backendFixtureSchema.safeParse({
      scenario: 'image-clean-world', runId: 'run-1', caseId: 'live_behavior.case', extra: 'no',
    }).success).toBe(false);
    expect(channelRequestSchema.safeParse({
      text: 'hola',
      user_id: 'user-123',
      channel: 'terminal_whatsapp_eval',
      backendFixture: { scenario: 'image-clean-world' },
    }).success).toBe(false);
  });
});
