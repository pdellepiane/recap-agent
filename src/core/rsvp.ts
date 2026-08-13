import { z } from 'zod';

export const rsvpActionValues = ['attending', 'declining'] as const;

export type RsvpAction = (typeof rsvpActionValues)[number];

export const rsvpCandidateStateSchema = z.object({
  guest_id: z.number().int().positive(),
  event_name: z.string().nullable(),
  event_date: z.string().nullable(),
});

export const rsvpStateSchema = z.object({
  status: z.enum(['none', 'awaiting_action', 'awaiting_event_selection']),
  pending_action: z.enum(rsvpActionValues).nullable(),
  candidates: z.array(rsvpCandidateStateSchema),
  requested_at: z.string().nullable(),
  selection_attempts: z.number().int().min(0),
});

export type RsvpState = z.infer<typeof rsvpStateSchema>;
