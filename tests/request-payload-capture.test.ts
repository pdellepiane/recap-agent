import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  CORRELATION_HEADER_NAME,
  PAYLOAD_SKELETON_MAX_LENGTH,
  captureProtectedPayload,
  readInboundCorrelationId,
  resolveRequestCorrelation,
} from '../src/lambda/request-payload-capture';

describe('inbound correlation id', () => {
  it('reads and validates the inbound correlation header without throwing', () => {
    expect(readInboundCorrelationId({ 'X-Recap-Correlation-Id': '  se-adapter-42 ' })).toBe('se-adapter-42');
    expect(readInboundCorrelationId({ [CORRELATION_HEADER_NAME]: 'abc_123.X:~-=' })).toBe('abc_123.X:~-=');
    expect(readInboundCorrelationId({})).toBeNull();
    expect(readInboundCorrelationId({ [CORRELATION_HEADER_NAME]: undefined })).toBeNull();
    expect(readInboundCorrelationId({ [CORRELATION_HEADER_NAME]: '   ' })).toBeNull();
    expect(readInboundCorrelationId({ [CORRELATION_HEADER_NAME]: 'a'.repeat(129) })).toBeNull();
    expect(readInboundCorrelationId({ [CORRELATION_HEADER_NAME]: 'a'.repeat(128) })).toBe('a'.repeat(128));
    expect(readInboundCorrelationId({ [CORRELATION_HEADER_NAME]: 'has space' })).toBeNull();
    expect(readInboundCorrelationId({ [CORRELATION_HEADER_NAME]: 'line\nbreak' })).toBeNull();
    expect(readInboundCorrelationId({ [CORRELATION_HEADER_NAME]: 'semi;colon' })).toBeNull();
    expect(readInboundCorrelationId({ [CORRELATION_HEADER_NAME]: 'quote"x' })).toBeNull();
  });

  it('resolves correlation with header, message-id, and request-id precedence', () => {
    expect(resolveRequestCorrelation({ [CORRELATION_HEADER_NAME]: 'adapter-1' }, 'lambda-1')).toEqual({
      correlationId: 'adapter-1',
      source: 'inbound_header',
    });
    expect(resolveRequestCorrelation({}, 'lambda-1')).toEqual({
      correlationId: 'lambda-1',
      source: 'lambda_request',
    });
    expect(resolveRequestCorrelation({ [CORRELATION_HEADER_NAME]: 'bad value' }, 'lambda-1')).toEqual({
      correlationId: 'lambda-1',
      source: 'lambda_request',
    });

    // Without adapter cooperation the native message id identifies the
    // turn; retries of the same inbound share one id across request ids.
    const rawBody = JSON.stringify({ message_id: 'wamid.HBgLNTYxOTk', text: 'hola' });
    expect(resolveRequestCorrelation({}, 'lambda-1', rawBody)).toEqual({
      correlationId: 'wamid.HBgLNTYxOTk',
      source: 'native_message',
    });
    expect(resolveRequestCorrelation({}, 'lambda-2', rawBody)).toEqual({
      correlationId: 'wamid.HBgLNTYxOTk',
      source: 'native_message',
    });

    // Unsafe message ids hash into a stable derived correlation.
    const unsafeBody = JSON.stringify({ message_id: 'has spaces & symbols!', text: 'hola' });
    const first = resolveRequestCorrelation({}, 'lambda-1', unsafeBody);
    const second = resolveRequestCorrelation({}, 'lambda-2', unsafeBody);
    expect(first.source).toBe('derived_message');
    expect(first.correlationId).toBe(second.correlationId);
    expect(first.correlationId).toMatch(/^auto-[0-9a-f]{32}$/u);
    expect(first.correlationId).not.toContain('spaces');

    // Header wins over the message id; the request id stays last.
    const headerBody = JSON.stringify({ message_id: 'wamid.abc', text: 'hola' });
    expect(
      resolveRequestCorrelation({ [CORRELATION_HEADER_NAME]: 'adapter-9' }, 'lambda-1', headerBody),
    ).toEqual({ correlationId: 'adapter-9', source: 'inbound_header' });
    expect(resolveRequestCorrelation({}, 'lambda-1', '{"text": "truncated')).toEqual({
      correlationId: 'lambda-1',
      source: 'lambda_request',
    });
    expect(
      resolveRequestCorrelation({}, 'lambda-1', JSON.stringify({ text: 'no id here' })),
    ).toEqual({ correlationId: 'lambda-1', source: 'lambda_request' });
  });
});

describe('protected payload capture', () => {
  it('returns null when no body bytes exist', () => {
    expect(captureProtectedPayload(undefined)).toBeNull();
    expect(captureProtectedPayload(null)).toBeNull();
    expect(captureProtectedPayload('')).toBeNull();
  });

  it('captures valid JSON shapes by fingerprint, inventory, and shape only', () => {
    const raw = JSON.stringify({
      text: 'hola', user_id: 'whatsapp:51999999999', channel: 'whatsapp',
      media: [], count: 3, flag: true, nothing: null,
    });
    const capture = captureProtectedPayload(raw);
    expect(capture).toMatchObject({
      bodyBytes: Buffer.byteLength(raw, 'utf8'),
      bodySha256: crypto.createHash('sha256').update(raw, 'utf8').digest('hex'),
      bodyParse: 'json_object',
      topLevelFields: [
        'channel:string',
        'count:number',
        'flag:boolean',
        'media:array',
        'nothing:null',
        'text:string',
        'user_id:string',
      ],
    });
    expect(capture?.arrayLength).toBeUndefined();

    const arrayRaw = '[1,"two",null,{"a":1}]';
    expect(captureProtectedPayload(arrayRaw)).toMatchObject({
      bodyParse: 'json_array',
      arrayLength: 4,
      arrayElementTypes: ['null', 'number', 'object', 'string'],
    });
    expect(captureProtectedPayload('"just a string"')?.bodyParse).toBe('json_scalar');
    expect(captureProtectedPayload('"just a string"')?.structureSkeleton).toBe('scalar:string');
    expect(captureProtectedPayload('42')?.bodyParse).toBe('json_scalar');
  });

  it('proves exact bytes for invalid JSON without logging raw values', () => {
    const raw = '{"text": "truncated secret message +96170197268';
    const capture = captureProtectedPayload(raw);
    expect(capture).toMatchObject({
      bodyBytes: Buffer.byteLength(raw, 'utf8'),
      bodySha256: crypto.createHash('sha256').update(raw, 'utf8').digest('hex'),
      bodyParse: 'invalid_json',
      structureSkeleton: `unparseable{bytes:${Buffer.byteLength(raw, 'utf8')}}`,
    });
    expect(capture?.topLevelFields).toBeUndefined();
    expect(JSON.stringify(capture)).not.toContain('truncated secret');
    expect(JSON.stringify(capture)).not.toContain('96170197268');
  });

  it('never emits raw customer content in the skeleton or inventory', () => {
    const raw = JSON.stringify({
      text: 'call +51999999999 or mail ana@example.com, see https://example.test/x',
      contact_phone: '+51999999999',
      user_id: 'whatsapp:+51999999999',
      message_id: 'wamid.secret123',
    });
    const capture = captureProtectedPayload(raw);
    const serialized = JSON.stringify(capture);
    expect(serialized).not.toContain('51999999999');
    expect(serialized).not.toContain('ana@example.com');
    expect(serialized).not.toContain('https://example.test/x');
    expect(serialized).not.toContain('wamid.secret123');
    expect(serialized).not.toContain('call +');
    expect(capture?.structureSkeleton).toContain('object{keys:');
  });

  it('hashes pre-validation identity fields and reports the phone parse outcome', () => {
    const raw = JSON.stringify({
      channel: 'whatsapp',
      message_id: 'wamid.abc',
      user_id: 'whatsapp:+96170197268',
      contact_phone: '+9991234567',
      text: 'hola',
    });
    const capture = captureProtectedPayload(raw);
    const sha = (value: string): string => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
    expect(capture?.identityHashes).toEqual({
      channel: 'whatsapp',
      messageIdSha256: sha('wamid.abc'),
      userIdSha256: sha('whatsapp:+96170197268'),
      contactPhoneSha256: sha('+9991234567'),
      contactPhoneParse: 'invalid:unsupported_country_code',
    });

    const validRaw = JSON.stringify({ channel: 'whatsapp', contact_phone: '+96170197268', text: 'hola' });
    const valid = captureProtectedPayload(validRaw);
    expect(valid?.identityHashes?.contactPhoneParse).toBe('valid');
    expect(JSON.stringify(valid)).not.toContain('96170197268');
  });

  it('bounds the skeleton length and the field inventory', () => {
    const big: Record<string, unknown> = {};
    for (let index = 0; index < 50; index += 1) {
      big[`field_${String(index).padStart(2, '0')}`] = 'x'.repeat(100);
    }
    const capture = captureProtectedPayload(JSON.stringify(big));
    expect(capture?.structureSkeleton.length).toBeLessThanOrEqual(PAYLOAD_SKELETON_MAX_LENGTH);
    expect(capture?.topLevelFields).toHaveLength(32);
    expect(capture?.topLevelFields?.[0]).toBe('field_00:string');
  });
});
