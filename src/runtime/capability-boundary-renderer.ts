import type { CapabilityDecision } from './capability-manifest';

export type CapabilityBoundaryMessageKey =
  | 'unsupported_human_once'
  | 'unsupported_human_repeat'
  | 'ambiguous_status'
  | 'ambiguous_document';

export type CapabilityBoundaryMessages = Readonly<
  Record<CapabilityBoundaryMessageKey, string>
>;

export type CapabilityBoundaryRenderState = {
  readonly humanTakeoverRequested?: boolean;
  readonly clarificationAsked?: boolean;
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
        key === 'unsupported_human_repeat' ||
        key === 'ambiguous_status' ||
        key === 'ambiguous_document')
    ) {
      entries.set(key, value);
    }
  }
  if (entries.size !== 4) {
    throw new Error('Capability boundary prompt is incomplete.');
  }
  return {
    unsupported_human_once: entries.get('unsupported_human_once') as string,
    unsupported_human_repeat: entries.get('unsupported_human_repeat') as string,
    ambiguous_status: entries.get('ambiguous_status') as string,
    ambiguous_document: entries.get('ambiguous_document') as string,
  };
}

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
    if (decision.kind === 'supported') return null;
    if (decision.kind === 'unsupported') {
      return state.humanTakeoverRequested
        ? this.messages.unsupported_human_repeat
        : this.messages.unsupported_human_once;
    }
    if (state.clarificationAsked) return null;
    return this.messages[decision.questionKey];
  }
}
