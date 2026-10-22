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
 * parked one can never inherit its state. The list keeps the most recent
 * three records and never drops one that is with a person: a parked takeover
 * is the record the thread must still honour.
 */
export function advanceOpenRequests(args: {
  readonly previous: readonly OpenRequest[];
  readonly sameOpenRequest: boolean;
  readonly openingText: string;
  readonly nextState: OpenRequestState | null;
  readonly nowIso: string;
  readonly openingKey: string;
}): readonly OpenRequest[] {
  const current = currentOpenRequest(args.previous);
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
    return [...args.previous.slice(0, -1), updated];
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

/** Keep the newest records, and always the ones parked with a person. */
function prune(requests: readonly OpenRequest[]): readonly OpenRequest[] {
  if (requests.length <= OPEN_REQUEST_LIMIT) {
    return requests;
  }
  const parked = requests.filter((request) => request.state === 'with_person');
  const others = requests.filter((request) => request.state !== 'with_person');
  const keep = [
    ...others.slice(-Math.max(0, OPEN_REQUEST_LIMIT - parked.length)),
    ...parked,
  ];
  // Preserve chronological order: the newest record stays last.
  const order = new Map(requests.map((request, index) => [request.key, index]));
  return keep.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
}

function boundText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= OPEN_REQUEST_TEXT_MAX_CHARS
    ? trimmed
    : `${trimmed.slice(0, OPEN_REQUEST_TEXT_MAX_CHARS)}…`;
}
