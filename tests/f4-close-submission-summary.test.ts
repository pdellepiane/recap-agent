import { describe, expect, it } from 'vitest';

import {
  applyCloseSubmissionToText,
  buildCloseSubmissionSummary,
  formatSpanishEventDate,
  parseFinishPlanTurnOutcome,
} from '../src/runtime/close-submission-summary';

describe('F4 explicit event date formats to Spanish long form', () => {
  it('formats a valid YYYY-MM-DD date', () => {
    expect(formatSpanishEventDate('2026-10-18')).toBe('18 de octubre de 2026');
  });

  it('rejects missing or calendar-invalid dates', () => {
    expect(formatSpanishEventDate(null)).toBe(null);
    expect(formatSpanishEventDate('')).toBe(null);
    expect(formatSpanishEventDate('2026-13-40')).toBe(null);
    expect(formatSpanishEventDate('18/10/2026')).toBe(null);
  });
});

describe('F4 close submission summary confirms sent quotes with the explicit date', () => {
  it('confirms both providers with the explicit date on success', () => {
    const text = buildCloseSubmissionSummary({
      status: 'success',
      eventDate: '2026-10-18',
      contactedProviders: [
        { providerId: 101, category: 'Catering', success: true },
        { providerId: 202, category: 'Música', success: true },
      ],
      displayByCategory: { Catering: 'EDO', 'Música': 'Orquesta Sintetica' },
    });
    expect(text).not.toBe(null);
    expect(text as string).toContain('18 de octubre de 2026');
    expect(text as string).toContain('EDO');
    expect(text as string).toContain('Orquesta Sintetica');
    expect(text as string).not.toContain('Confirmas');
  });

  it('reports per-provider blocked state without claiming closure on partial', () => {
    const text = buildCloseSubmissionSummary({
      status: 'partial',
      eventDate: '2026-10-18',
      contactedProviders: [
        { providerId: 101, category: 'Catering', success: true },
        { providerId: 202, category: 'Música', success: false, error: 'unresolved' },
      ],
      displayByCategory: { Catering: 'EDO', 'Música': 'Orquesta Sintetica' },
    });
    expect(text).not.toBe(null);
    expect(text as string).toContain('18 de octubre de 2026');
    expect(text as string).toContain('EDO');
    expect(text as string).toContain('Orquesta Sintetica');
    expect(text as string).not.toMatch(/plan cerrado|cerrado el plan/iu);
  });

  it('reports blocked providers truthfully with the explicit date when all writes fail', () => {
    const text = buildCloseSubmissionSummary({
      status: 'failed',
      eventDate: '2026-10-18',
      contactedProviders: [
        { providerId: 101, category: 'Catering', success: false, error: 'blocked' },
        { providerId: 202, category: 'Música', success: false, error: 'blocked' },
      ],
      displayByCategory: { Catering: 'EDO', 'Música': 'Orquesta Sintetica' },
    });
    expect(text).not.toBe(null);
    expect(text as string).toContain('18 de octubre de 2026');
    expect(text as string).toContain('EDO');
    expect(text as string).toContain('Orquesta Sintetica');
    expect(text as string).toContain('bloque');
    expect(text as string).not.toContain('Confirmas');
    expect(text as string).not.toMatch(/fueron enviadas|fue enviada/iu);
    expect(text as string).not.toMatch(/plan cerrado|cerrado el plan/iu);
  });

  it('returns null when the date is missing or no provider was attempted', () => {
    expect(
      buildCloseSubmissionSummary({
        status: 'success',
        eventDate: null,
        contactedProviders: [{ providerId: 101, category: 'Catering', success: true }],
        displayByCategory: { Catering: 'EDO' },
      }),
    ).toBe(null);
    expect(
      buildCloseSubmissionSummary({
        status: 'failed',
        eventDate: '2026-10-18',
        contactedProviders: [],
        displayByCategory: {},
      }),
    ).toBe(null);
  });
});

describe('F4 plain-text confirmation question is replaced by the submission summary', () => {
  it('replaces the confirmation question and strips the legacy future-tense footer', () => {
    const text = applyCloseSubmissionToText(
      'Ya tengo tu nombre, correo electrónico y teléfono. ¿Confirmas que envíe la solicitud de cotización a EDO, Orquesta Sintetica?\n\nSe enviarán solicitudes para:\n\n- Servicio de comida: EDO.',
      'Las solicitudes de cotización fueron enviadas a EDO y Orquesta Sintetica para tu evento del 18 de octubre de 2026. Los proveedores se pondrán en contacto contigo por correo electrónico o teléfono.',
    );
    expect(text).toContain('18 de octubre de 2026');
    expect(text).toContain('fueron enviadas');
    expect(text.match(/fueron enviadas|fue enviada/giu)).toHaveLength(1);
    expect(text).not.toContain('¿Confirmas');
    expect(text).not.toMatch(/Se enviar[áa]n solicitudes para/iu);
    expect(text).not.toContain('Servicio de comida: EDO');
  });

  it('leaves text without a confirmation question untouched', () => {
    expect(applyCloseSubmissionToText('Hola, ¿en qué te ayudo?', 'Resumen.')).toBe(
      'Hola, ¿en qué te ayudo?',
    );
    expect(applyCloseSubmissionToText('¿Confirmas?', null)).toBe('¿Confirmas?');
  });
});

describe('F4 finish_plan turn outcome parses defensively', () => {
  it('parses a success output with explicit date and providers', () => {
    const outcome = parseFinishPlanTurnOutcome(
      JSON.stringify({
        status: 'success',
        eventDate: '2026-10-18',
        contacted_providers: [{ providerId: 101, category: 'Catering', success: true }],
      }),
    );
    expect(outcome?.status).toBe('success');
    expect(outcome?.eventDate).toBe('2026-10-18');
    expect(outcome?.contactedProviders).toHaveLength(1);
  });

  it('parses failed-all provider results that carry an explicit date', () => {
    const outcome = parseFinishPlanTurnOutcome(
      JSON.stringify({
        status: 'failed',
        eventDate: '2026-10-18',
        contacted_providers: [
          { providerId: 101, category: 'Catering', success: false, error: 'blocked' },
          { providerId: 202, category: 'Música', success: false, error: 'blocked' },
        ],
      }),
    );
    expect(outcome?.status).toBe('failed');
    expect(outcome?.eventDate).toBe('2026-10-18');
    expect(outcome?.contactedProviders).toHaveLength(2);
  });

  it('returns undefined for error results or malformed payloads', () => {
    expect(
      parseFinishPlanTurnOutcome(JSON.stringify({ status: 'failed', error: 'missing_event_date' })),
    ).toBe(undefined);
    expect(parseFinishPlanTurnOutcome('not json')).toBe(undefined);
  });
});
