import { z } from 'zod';

export const supportContinuityMessagesSchema = z.object({
  mailboxReport: z.string().min(1),
  mailboxDetail: z.string().min(1),
  paymentProofReported: z.string().min(1),
  deferred: z.string().min(1),
  genericReport: z.string().min(1),
  genericDetail: z.string().min(1),
}).strict();

export type SupportContinuityMessages = z.infer<
  typeof supportContinuityMessagesSchema
>;
