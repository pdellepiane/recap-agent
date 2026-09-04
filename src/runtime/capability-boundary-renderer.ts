import type { CapabilityDecision } from './capability-manifest';

export type CapabilityBoundaryMessageKey =
  | 'unsupported_human_once'
  | 'unsupported_human_failed'
  | 'unsupported_human_repeat'
  | 'unsupported_operation_once'
  | 'unsupported_operation_failed'
  | 'status_or_document'
  | 'status_or_proof_review'
  | 'type_missing'
  | 'image_limitation'
  | 'proof_limitation';

export type CapabilityBoundaryMessages = Readonly<
  Record<CapabilityBoundaryMessageKey, string>
>;

export type CapabilityBoundaryRenderState = {
  readonly humanTakeoverRequested?: boolean;
  readonly clarificationAsked?: boolean;
  readonly humanTakeoverSucceeded?: boolean;
  readonly humanTakeoverFailed?: boolean;
};

/** Parses the key/value prompt resource without introducing free-text routing. */
export function parseCapabilityBoundaryMessages(
  content: string,
): CapabilityBoundaryMessages {
  const entries = new Map<CapabilityBoundaryMessageKey, string>();
  for (const line of content.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim() as CapabilityBoundaryMessageKey;
    const value = line.slice(separator + 1).trim();
    if (
      value.length > 0 &&
      (key === 'unsupported_human_once' ||
        key === 'unsupported_human_failed' ||
        key === 'unsupported_human_repeat' ||
        key === 'unsupported_operation_once' ||
        key === 'unsupported_operation_failed' ||
        key === 'status_or_document' ||
        key === 'status_or_proof_review' ||
        key === 'type_missing' ||
        key === 'image_limitation' ||
        key === 'proof_limitation')
    ) {
      entries.set(key, value);
    }
  }
  if (entries.size !== 10) {
    throw new Error('Capability boundary prompt is incomplete.');
  }
  return {
    unsupported_human_once: entries.get('unsupported_human_once') as string,
    unsupported_human_failed: entries.get('unsupported_human_failed') as string,
    unsupported_human_repeat: entries.get('unsupported_human_repeat') as string,
    unsupported_operation_once: entries.get('unsupported_operation_once') as string,
    unsupported_operation_failed: entries.get('unsupported_operation_failed') as string,
    status_or_document: entries.get('status_or_document') as string,
    status_or_proof_review: entries.get('status_or_proof_review') as string,
    type_missing: entries.get('type_missing') as string,
    image_limitation: entries.get('image_limitation') as string,
    proof_limitation: entries.get('proof_limitation') as string,
  };
}

export const defaultCapabilityBoundaryMessages: CapabilityBoundaryMessages = {
  unsupported_human_once: 'Puedo consultar el estado registrado, pero no puedo emitir ni reenviar una constancia desde aquí. Ya solicité apoyo humano para que continúen con ese pedido.',
  unsupported_human_failed: 'Puedo consultar el estado registrado, pero no puedo emitir ni reenviar una constancia desde aquí. En este momento no pude registrar el apoyo humano.',
  unsupported_human_repeat: 'El apoyo humano ya fue solicitado para continuar con este pedido.',
  unsupported_operation_once: 'No puedo realizar esa gestión desde aquí. Ya solicité apoyo humano para que continúen con este pedido.',
  unsupported_operation_failed: 'No puedo realizar esa gestión desde aquí. En este momento no pude registrar el apoyo humano.',
  status_or_document: '¿Quieres consultar si el pago está confirmado o necesitas que te envíen una constancia?',
  status_or_proof_review: '¿Quieres consultar el estado registrado del pago o necesitas que una persona revise el comprobante?',
  type_missing: '¿Qué necesitas hacer exactamente con esta información?',
  image_limitation: 'No puedo leer ni revisar el contenido de imágenes. Puedes escribir aquí el dato relevante o puedo solicitar apoyo humano.',
  proof_limitation: 'No puedo validar un comprobante a partir de una imagen. Puedo consultar el estado registrado del pago o solicitar que una persona revise el comprobante.',
};

/**
 * Renders only typed capability outcomes. The caller persists the two booleans
 * so unsupported actions and clarifications are emitted at most once.
 */
export class CapabilityBoundaryRenderer {
  constructor(private readonly messages: CapabilityBoundaryMessages) {}

  render(
    decision: CapabilityDecision,
    state: CapabilityBoundaryRenderState = {},
  ): string | null {
    if (decision.status === 'not_applicable' || decision.status === 'supported') return null;
    if (decision.status === 'unsupported') {
      if (decision.operation === 'media.image.inspect') {
        const base = this.messages.image_limitation;
        return state.humanTakeoverFailed
          ? `${base} ${this.messages.unsupported_human_failed}`
          : state.humanTakeoverSucceeded
            ? `${base} Ya solicité apoyo humano para continuar.`
            : base;
      }
      if (decision.operation === 'payment_proof.verify') {
        const base = this.messages.proof_limitation;
        return state.humanTakeoverFailed
          ? `${base} ${this.messages.unsupported_operation_failed}`
          : state.humanTakeoverSucceeded
            ? `${base} Ya solicité apoyo humano para continuar.`
            : base;
      }
      if (decision.operation === 'confirmation_document.send') {
        if (state.humanTakeoverFailed) return this.messages.unsupported_human_failed;
        return state.humanTakeoverRequested
          ? this.messages.unsupported_human_repeat
          : this.messages.unsupported_human_once;
      }
      if (state.humanTakeoverFailed) return this.messages.unsupported_operation_failed;
      return state.humanTakeoverRequested
        ? this.messages.unsupported_human_repeat
        : this.messages.unsupported_operation_once;
    }
    if (state.clarificationAsked) return null;
    return this.messages[decision.questionKey];
  }
}
