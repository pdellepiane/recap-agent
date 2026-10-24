/**
 * The open-request record.
 *
 * One record per request the guest made that the runtime has not settled. The
 * record is written from what happened to the request (it was answered, it
 * needs a datum, it went to a person, it stayed open), never from a guess
 * about how the conversation feels.
 *
 * Every escalation rule reads this record. The previous design inferred
 * "stuck" from four overlapping signals (a probability, a rubric level, a
 * money signature and a counter over the first two). Those signals were
 * proxies for this one fact: the request is still open and the guest asked
 * again.
 */
import { z } from 'zod';

/** The four states a request can be in. */
export const openRequestStateValues = [
  'answered',
  'needs_input',
  'with_person',
  'unresolved',
] as const;

export type OpenRequestState = (typeof openRequestStateValues)[number];

export const openRequestSchema = z.object({
  /** The inbound message id that opened the request. Stable, never positional. */
  key: z.string(),
  /**
   * The guest's own words that opened the request, bounded. Evidence, never an
   * interpretation: nothing derives this text from keywords or from a reply.
   */
  opening_text: z.string(),
  state: z.enum(openRequestStateValues),
  /** ISO timestamp when the current state began. */
  since: z.string(),
  /** Turns this request has been open, including the turn that opened it. */
  turns: z.number().int().min(1),
  /** Customer report scoped to this request, never a backend payment receipt. */
  financial_reconciliation_required: z.boolean().optional(),
  reported_payment: z.object({ amount: z.number().nullable(), currency: z.string().nullable(),
    method: z.string().nullable(), claimed_success: z.boolean() }).nullable().optional(),
});

export type OpenRequest = z.infer<typeof openRequestSchema>;

/** At most three open requests: the current one and the recent parked ones. */
export const OPEN_REQUEST_LIMIT = 3;

/** The opening text is evidence, not a transcript. */
export const OPEN_REQUEST_TEXT_MAX_CHARS = 120;

/** The request the current turn is about: the most recent record. */
export function currentOpenRequest(
  requests: readonly OpenRequest[],
): OpenRequest | null {
  return requests.length === 0 ? null : requests[requests.length - 1] ?? null;
}

/**
 * The state the turn leaves the request in, or null when the turn does not
 * change it.
 *
 * The mapping is the whole engine:
 *
 * - `pause` keeps the record: the thread is parked, nothing happened.
 * - `escalate` records the real outcome of the attempt: a confirmed takeover
 *   parks the request with a person, anything else leaves it open.
 * - `clarify` asks for a datum, so the request needs input.
 * - `answer` settles the request only when the turn settled it and the money
 *   evidence agrees; a turn that answered while the money stayed unresolved
 *   leaves the request open.
 * - `suppress_ack`, `offer_human`, `planning` and `rsvp` do not change the
 *   request they did not address.
 */
export function nextOpenRequestState(args: {
  readonly outcome:
    | 'pause'
    | 'escalate'
    | 'offer_human'
    | 'answer'
    | 'clarify'
    | 'suppress_ack'
    | 'planning'
    | 'rsvp';
  readonly handoffConfirmed: boolean;
  readonly requestSettled: boolean;
  readonly unresolvedMoney: boolean;
}): OpenRequestState | null {
  switch (args.outcome) {
    case 'pause':
    case 'suppress_ack':
    case 'offer_human':
      return null;
    case 'escalate':
      return args.handoffConfirmed ? 'with_person' : 'unresolved';
    case 'clarify':
      return 'needs_input';
    case 'answer':
      return args.requestSettled && !args.unresolvedMoney ? 'answered' : 'unresolved';
    case 'planning':
    case 'rsvp':
      return 'answered';
  }
}

/**
 * Advance the record list with this turn.
 *
 * `sameOpenRequest` false opens a new record, so a question that is not the
 * parked one can never inherit its state. The list keeps three records: a
 * record parked with a person outlives a settled one, and a parked record is
 * only dropped when every slot is already parked, because the list is bounded
 * and the plan schema rejects a fourth.
 */
export function advanceOpenRequests(args: {
  readonly previous: readonly OpenRequest[];
  readonly selectedRequestKey?: string | null;
  readonly sameOpenRequest: boolean;
  readonly openingText: string;
  readonly nextState: OpenRequestState | null;
  readonly nowIso: string;
  readonly openingKey: string;
}): readonly OpenRequest[] {
  if (args.selectedRequestKey != null && !args.previous.some((request) => request.key === args.selectedRequestKey)) {
    throw new Error('Selected request identity does not belong to the retained request set.');
  }
  const current = args.selectedRequestKey !== undefined
    ? args.previous.find((request) => request.key === args.selectedRequestKey) ?? null
    : currentOpenRequest(args.previous);
  if (args.sameOpenRequest && current !== null) {
    if (args.nextState === null) {
      return args.previous;
    }
    const updated: OpenRequest = {
      ...current,
      state: args.nextState,
      since: args.nextState === current.state ? current.since : args.nowIso,
      turns: current.turns + 1,
    };
    return args.previous.map((request) => request.key === current.key ? updated : request);
  }
  if (args.nextState === null) {
    return args.previous;
  }
  const opened: OpenRequest = {
    key: args.openingKey,
    opening_text: boundText(args.openingText),
    state: args.nextState,
    since: args.nowIso,
    turns: 1,
  };
  return prune([...args.previous, opened]);
}

/** Keep the newest records, and prefer a parked one over a settled one. */
function prune(requests: readonly OpenRequest[]): readonly OpenRequest[] {
  const kept = [...requests];
  while (kept.length > OPEN_REQUEST_LIMIT) {
    // The newest record is the request this turn is about, so it never gives up
    // its slot. Among the older ones a settled record goes first; a list that
    // is entirely parked loses its oldest parked record, because the list is
    // bounded and the plan schema rejects a fourth.
    const older = kept.slice(0, -1);
    const settled = older.findIndex((request) => request.state !== 'with_person');
    kept.splice(settled >= 0 ? settled : 0, 1);
  }
  return kept;
}

function boundText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= OPEN_REQUEST_TEXT_MAX_CHARS
    ? trimmed
    : `${trimmed.slice(0, OPEN_REQUEST_TEXT_MAX_CHARS)}…`;
}
