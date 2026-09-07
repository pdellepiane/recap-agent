import { z } from 'zod';

export const rsvpActionValues = ['attending', 'declining'] as const;

export type RsvpAction = (typeof rsvpActionValues)[number];

export const rsvpDecisionSourceValues = ['current_message', 'plan_state'] as const;

export type RsvpDecisionSource = (typeof rsvpDecisionSourceValues)[number];

export const rsvpPartyScopeValues = ['self', 'self_and_others'] as const;

export type RsvpPartyScope = (typeof rsvpPartyScopeValues)[number];

export const rsvpPartySchema = z
  .object({
    scope: z.enum(rsvpPartyScopeValues),
    mentioned_names: z.array(z.string().trim().min(1)),
    companion_count: z.enum(['one', 'multiple', 'unknown']).nullable().optional(),
    plus_one_response: z.enum(['yes', 'no', 'unknown']).nullable().optional(),
  })
  .strict();

export type RsvpParty = z.infer<typeof rsvpPartySchema>;

export const rsvpCandidateStateSchema = z.object({
  guest_id: z.number().int().positive(),
  event_name: z.string().nullable(),
  event_date: z.string().nullable(),
});

export const rsvpAttendanceFactValues = [
  'pending',
  'attending',
  'declining',
  'unknown',
  'ambiguous',
  'unavailable',
] as const;

export type RsvpAttendanceFact = (typeof rsvpAttendanceFactValues)[number];

export const rsvpStateSchema = z.object({
  status: z.enum(['none', 'awaiting_action', 'awaiting_event_selection']),
  pending_action: z.enum(rsvpActionValues).nullable(),
  pending_plus_one_response: z.enum(['yes', 'no']).nullable().optional(),
  candidates: z.array(rsvpCandidateStateSchema),
  requested_at: z.string().nullable(),
  selection_attempts: z.number().int().min(0),
  last_offer_key: z.string().nullable().optional(),
  offer_no_change: z.boolean().optional(),
});

export type RsvpState = z.infer<typeof rsvpStateSchema>;

function normalizeRsvpKeyText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildRsvpOfferKey(args: {
  readonly guestId: number;
  readonly eventId: number | null;
  readonly eventName: string | null;
  readonly eventDate: string | null;
  readonly attendance: string;
}): string {
  const eventPart = args.eventId !== null && Number.isSafeInteger(args.eventId)
    ? `id:${args.eventId}`
    : `name:${normalizeRsvpKeyText(args.eventName ?? '')}|date:${normalizeRsvpKeyText(args.eventDate ?? '')}`;
  return `g${args.guestId}:${eventPart}:s${normalizeRsvpKeyText(args.attendance)}`;
}
