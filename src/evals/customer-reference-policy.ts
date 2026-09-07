export const CUSTOMER_REFERENCE_POLICY_VERSION = '2026-09-05-s13-v1';

export const OTP_POLICY_VERSION =
  '2026-09-05-s13-v1 one-shot OTP: one send and at most one verification; ' +
  'first non-delivery, failure, resend request, email-change request, or refusal ' +
  'terminates OTP recovery to human help with no resend and no second verification. ' +
  'Historical resend expectations are superseded, not silently weakened.';

export type HandoffOutcome = 'success' | 'failed' | 'unknown';

export const HANDOFF_FALLBACK_TEXT: Record<HandoffOutcome, string> = {
  success: 'Ya solicite ayuda humana para tu consulta pendiente y deje la conversacion con ese equipo.',
  failed:
    'Intente pedir ayuda humana pero la derivacion automatica fallo; sigo disponible para consultas generales sin prometer tiempos ni tickets.',
  unknown:
    'Pedi ayuda humana pero el resultado de la derivacion quedo incierto; no reintento automaticamente y mantengo tu consulta pendiente sin inventar colas ni plazos.',
};

const CUSTOMER_VISIBLE_PATTERN = /^(?:COD[\s_-]*)?\d+$/iu;

export function projectCustomerReference(args: {
  customerTransactionNumber: string | null | undefined;
  referenceAuthorized: boolean;
}): string | null {
  if (!args.referenceAuthorized) {
    return null;
  }
  const trimmed = args.customerTransactionNumber?.trim();
  if (!trimmed) {
    return null;
  }
  if (!CUSTOMER_VISIBLE_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}
