import type { TurnCapabilityOutcome } from './turn-capability-policy';
import type { HandoffOutcome } from './human-help-policy';

export const capabilityOutcomeKeys = [
  'unsupported_once',
  'unsupported_failed',
  'handoff_requested',
  'handoff_failed',
  'handoff_unknown',
  'handoff_duplicate',
  'missing_identity',
  'otp_exhausted',
  'gateway_failure',
  'capability_changed',
  'already_completed',
  'needs_input',
  'unavailable',
  'capability_list_header',
] as const;

export type CapabilityOutcomeKey = (typeof capabilityOutcomeKeys)[number];

export type CapabilityOutcomeMessages = Record<CapabilityOutcomeKey, string>;

export function parseCapabilityOutcomeMessages(content: string): CapabilityOutcomeMessages {
  const entries = new Map<string, string>();
  for (const line of content.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value.length > 0) entries.set(key, value);
  }
  const missing = capabilityOutcomeKeys.filter((key) => !entries.has(key));
  if (missing.length > 0) {
    throw new Error(`Capability outcome prompt is incomplete: missing ${missing.join(',')}.`);
  }
  return Object.fromEntries(
    capabilityOutcomeKeys.map((key) => [key, entries.get(key) as string]),
  ) as CapabilityOutcomeMessages;
}

export const defaultCapabilityOutcomeMessages: CapabilityOutcomeMessages = {
  unsupported_once: 'No puedo hacer esa gestion desde aqui. Ya solicite apoyo humano para continuar.',
  unsupported_failed: 'No puedo hacer esa gestion desde aqui. En este momento no pude registrar el apoyo humano.',
  handoff_requested: 'Ya solicite apoyo humano para continuar con tu pedido.',
  handoff_failed: 'En este momento no pude registrar el apoyo humano. Puedo seguir ayudandote con consultas generales.',
  handoff_unknown: 'No pude confirmar si el apoyo humano quedo registrado. No lo reintentare automaticamente.',
  handoff_duplicate: 'El apoyo humano ya fue solicitado para este pedido.',
  missing_identity: 'No pude verificar tu identidad con el numero de esta conversacion. Solicitare apoyo humano.',
  otp_exhausted: 'Ya se uso el unico intento de verificacion disponible. Solicitare apoyo humano.',
  gateway_failure: 'La accion estaba disponible, pero el servicio fallo. Solicitare apoyo humano.',
  capability_changed: 'La disponibilidad cambio desde el ultimo mensaje. Revisare la opcion actual antes de continuar.',
  already_completed: 'Este pedido ya quedo registrado. No es necesario repetirlo.',
  needs_input: 'Me falta un dato necesario para continuar.',
  unavailable: 'Esta opcion no esta disponible en este momento. Solicitare apoyo humano.',
  capability_list_header: 'Puedo ayudarte con lo siguiente:',
};

export type StructuralClaim = {
  readonly operation: string;
  readonly claimsSuccess: boolean;
  readonly receiptPresent: boolean;
};

export function claimAllowsSuccess(claims: readonly StructuralClaim[]): boolean {
  for (const claim of claims) {
    if (claim.claimsSuccess && !claim.receiptPresent) return false;
  }
  return true;
}

export class CapabilityOutcomeRenderer {
  constructor(private readonly messages: CapabilityOutcomeMessages) {}

  renderTurnOutcome(outcome: TurnCapabilityOutcome, handoff: HandoffOutcome | null = null): string {
    switch (outcome.status) {
      case 'unsupported':
        return handoff === 'handoff_failed' ? this.messages.unsupported_failed : this.messages.unsupported_once;
      case 'already_completed':
        return this.messages.already_completed;
      case 'needs_input': {
        const needed = outcome.requiredInput.length > 0 ? `: ${outcome.requiredInput.join(', ')}` : '';
        return `${this.messages.needs_input}${needed}`;
      }
      case 'blocked':
        if (outcome.reason === 'missing_identity') return this.messages.missing_identity;
        if (outcome.reason === 'attempts_exhausted') return this.messages.otp_exhausted;
        return handoff === 'handoff_failed' ? this.messages.unsupported_failed : this.messages.unsupported_once;
      case 'unavailable':
        return this.messages.gateway_failure;
      case 'executable':
        return this.messages.capability_changed;
    }
  }

  renderHandoffOutcome(outcome: HandoffOutcome, verifiedSupportLink: string | null = null): string {
    const base =
      outcome === 'handoff_requested'
        ? this.messages.handoff_requested
        : outcome === 'handoff_failed'
          ? this.messages.handoff_failed
          : outcome === 'outcome_unknown'
            ? this.messages.handoff_unknown
            : this.messages.handoff_duplicate;
    if (verifiedSupportLink !== null && outcome !== 'handoff_requested') {
      return `${base} ${verifiedSupportLink}`;
    }
    return base;
  }

  renderCapabilityList(items: readonly string[]): string {
    if (items.length === 0) return this.messages.capability_list_header;
    return `${this.messages.capability_list_header}\n${items.map((item) => `- ${item}`).join('\n')}`;
  }
}
