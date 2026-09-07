import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { z } from 'zod';

import { normalizeBackendCustomerTransactionNumber } from '../core/order-reference';
import { rsvpActionValues } from '../core/rsvp';
import type {
  AgentAuthByPhoneInput,
  AgentAuthByPhoneResult,
  AgentConversationGateway,
  AgentConversationMessage,
  AgentEventDetailResult,
  AgentGatewayResult,
  AgentGuestEventsResult,
  AgentGuestRsvpInput,
  AgentGuestRsvpResult,
  AgentMessageLogInput,
  AgentPhonePurchaseLookupResult,
  AgentPurchaseLookupResult,
  AgentUpdatePhoneResult,
  RsvpCandidate,
} from './agent-conversation-gateway';
import type {
  UserLoginCodeRequestResult,
  UserLoginCodeVerificationResult,
} from './provider-gateway';
import type { CartInformation, PurchaseInformation, PurchasePartition, PurchaseResource } from '../core/information';
import {
  buildRuntimeCapabilityManifest,
  type RuntimeCapabilityManifest,
} from './capability-manifest';
import { normalizeServerTimestamp } from '../core/server-timestamp';
import type { EvalFixtureStateStore, FixtureEffectReceipt } from './eval-fixture-state';
import { InMemoryEvalFixtureStateStore, assertFixtureAllowed } from './eval-fixture-state';

export { normalizeServerTimestamp as normalizePurchaseTimestamp } from '../core/server-timestamp';

export function assertFixtureMarkerAllowed(environment: string): void {
  assertFixtureAllowed(environment);
}

export type FixtureGatewayEffectOptions = {
  allowCustomerWrites?: boolean;
  runId?: string;
  caseId?: string;
  stateStore?: EvalFixtureStateStore;
};

export type EvalFixtureScenario = string;

export type FixtureLoadResult =
  | { status: 'loaded'; data: FixtureData }
  | { status: 'unknown_scenario'; scenario: string; error: string }
  | { status: 'malformed'; scenario: string; error: string };

export type FixtureData = {
  scenario?: string;
  guestOrders?: Record<string, unknown>;
  guestGiftPurchases?: Record<string, unknown>;
  guestEvents?: Record<string, unknown>;
  eventDetails?: Record<string, unknown>;
  rsvp?: Record<string, unknown>;
  /** Deterministic provider-auth outcomes used by isolated live evaluations. */
  emailAuth?: unknown;
};

const rsvpEventSchema = z.object({
  name: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).nullable().optional(),
  date: z.string().trim().min(1).nullable().optional(),
  event_date: z.string().trim().min(1).nullable().optional(),
}).passthrough();

const rsvpResponseDataSchema = z.object({
  guest_id: z.number().int().positive().nullable().optional(),
  action: z.enum(rsvpActionValues).optional(),
  already_responded: z.boolean().optional(),
  will_attend: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable().optional(),
  event_name: z.string().trim().min(1).nullable().optional(),
  event_date: z.string().trim().min(1).nullable().optional(),
  event: rsvpEventSchema.nullable().optional(),
  plus_one: z.object({
    saved: z.boolean(),
    response: z.enum(['yes', 'no']).nullable().optional(),
    reason: z.string().trim().min(1).nullable().optional(),
  }).nullable().optional(),
}).passthrough();

const rsvpCombinedResponseDataSchema = z.object({
  rsvp: rsvpResponseDataSchema.nullable().optional(),
  plus_one: z.object({
    saved: z.boolean(),
    response: z.enum(['yes', 'no']).nullable().optional(),
    reason: z.string().trim().min(1).nullable().optional(),
  }).nullable().optional(),
}).passthrough();

const rsvpCandidateSchema = z.object({
  guest_id: z.number().int().positive(),
  event_name: z.string().trim().min(1).nullable().optional(),
  event_date: z.string().trim().min(1).nullable().optional(),
  event: rsvpEventSchema.nullable().optional(),
}).passthrough();

type RsvpCandidateWire = z.infer<typeof rsvpCandidateSchema>;

const rsvpCandidateEnvelopeSchema = z.union([
  z.object({ pending_guests: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.object({ candidates: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.object({ pending: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.object({ invitations: z.array(rsvpCandidateSchema).min(2) }).passthrough(),
  z.array(rsvpCandidateSchema).min(2),
]);

const guestEventSchema = z.object({
  event_id: z.number().int().positive(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  url: z.string().trim().min(1).nullable().optional(),
  datetime: z.string().trim().min(1).nullable().optional(),
  type: z.string().trim().min(1).nullable().optional(),
  type_detail: z.string().trim().min(1).nullable().optional(),
  stage: z.string().trim().min(1).nullable().optional(),
  city: z.string().trim().min(1).nullable().optional(),
  country: z.string().trim().min(1).nullable().optional(),
  currency: z.string().trim().min(1).nullable().optional(),
  role: z.literal('guest'),
});

const guestEventsDataSchema = z.object({
  events: z.array(guestEventSchema),
});

const eventCountrySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  short_code: z.string().trim().min(1),
});

const eventDetailSchema = z.object({
  event_id: z.number().int().positive(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  url: z.string().trim().min(1).nullable().optional(),
  type: z.string().trim().min(1).nullable().optional(),
  type_detail: z.string().trim().min(1).nullable().optional(),
  datetime: z.string().trim().min(1).nullable().optional(),
  with_time: z.boolean(),
  timezone: z.string().trim().min(1).nullable().optional(),
  city: z.string().trim().min(1).nullable().optional(),
  country: eventCountrySchema.nullable().optional(),
  currency: z.string().trim().min(1).nullable().optional(),
  stage: z.string().trim().min(1).nullable().optional(),
  celebrateds: z.array(z.object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1).nullable().optional(),
  })).default([]),
  moments: z.array(z.object({
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable().optional(),
    datetime: z.string().trim().min(1).nullable().optional(),
    with_time: z.boolean(),
    location_description: z.string().trim().min(1).nullable().optional(),
    location_reference: z.string().trim().min(1).nullable().optional(),
    location_url: z.string().trim().min(1).nullable().optional(),
    location_coords: z.string().trim().min(1).nullable().optional(),
    position: z.number().int().nonnegative(),
  })).default([]),
  dresscode: z.object({
    type: z.string().trim().min(1).nullable().optional(),
    description: z.string().trim().min(1).nullable().optional(),
  }).nullable().optional(),
  common_asked: z.array(z.object({
    question: z.string().trim().min(1),
    answer: z.string().trim().min(1),
  })).default([]),
  contact_info: z.union([
    z.array(z.object({
      label: z.string().trim().min(1),
      value: z.string().trim().min(1),
    })),
    z.record(z.string(), z.string().trim().min(1).nullable()),
  ]).default([]),
});

const attendanceSchema = z.object({
  guest_id: z.number().int().positive(),
  name: z.string().trim().min(1),
  has_responded: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  will_attend: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable(),
  response_date: z.string().trim().min(1).nullable(),
});

const messageSchema = z.object({
  id: z.number(),
  direction: z.enum(['inbound', 'outbound']),
  source: z.string().nullable().optional(),
  body: z.string(),
  status: z.string(),
  whatsapp_message_id: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

const messagesDataSchema = z.object({
  messages: z.array(messageSchema),
});

const nullableStringSchema = z.string().nullable().optional();
const nullableNumberSchema = z.number().nullable().optional();

const purchaseItemSchema = z.object({
  gift_name: nullableStringSchema,
  quantity: nullableNumberSchema,
  amount: nullableNumberSchema,
  row_total: nullableNumberSchema,
  type: nullableStringSchema,
});

const destinationAccountSchema = z.object({
  holder: nullableStringSchema,
  bank: nullableStringSchema,
  number: nullableStringSchema,
  cci: nullableStringSchema,
  type: nullableStringSchema,
});

const paymentSchema = z.object({
  method: nullableStringSchema,
  amount: nullableNumberSchema,
  payment_id: nullableStringSchema,
  transaction_status: nullableStringSchema,
  gateway_message: nullableStringSchema,
  op_code: nullableStringSchema,
  origin_bank: nullableStringSchema,
  destination_account: destinationAccountSchema.nullable().optional(),
  voucher: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  paid_at: nullableStringSchema,
});

const orderSchema = z.object({
  id: z.string().min(1),
  increment_id: z.union([z.string(), z.number()]).nullable().optional(),
  name: nullableStringSchema,
  email: nullableStringSchema,
  payment_status: nullableStringSchema,
  shipping_status: nullableStringSchema,
  grand_total: nullableNumberSchema,
  payment_method: nullableStringSchema,
  event_id: z.union([z.number(), z.string()]).nullable().optional(),
  currency: nullableStringSchema.optional(),
  event_name: nullableStringSchema,
  event_date: nullableStringSchema,
  event_url: nullableStringSchema,
  items: z.array(purchaseItemSchema).default([]),
  created_at: nullableStringSchema,
});

const cartSchema = z.object({
  cart_id: z.union([z.string().trim().min(1), z.number().int().positive()]),
  status: z.string().trim().min(1),
  was_abandoned: z.boolean(),
  event_id: z.union([z.number(), z.string()]).nullable().optional(),
  event_name: nullableStringSchema,
  event_date: nullableStringSchema,
  event_url: nullableStringSchema,
  subtotal: nullableNumberSchema,
  gifts_quantity: nullableNumberSchema,
  items: z.array(purchaseItemSchema).default([]),
  created_at: nullableStringSchema,
});

const giftPurchaseSchema = z.object({
  id: z.string().min(1),
  increment_id: z.union([z.string(), z.number()]).nullable().optional(),
  payment_status: nullableStringSchema,
  shipping_status: nullableStringSchema,
  grand_total: nullableNumberSchema,
  is_thanked: z.boolean().nullable().optional(),
  payment: paymentSchema.nullable().optional(),
  decline_code: nullableStringSchema,
  admin_comment: nullableStringSchema,
  event_id: z.union([z.number(), z.string()]).nullable().optional(),
  currency: nullableStringSchema.optional(),
  event_name: nullableStringSchema,
  event_date: nullableStringSchema,
  event_url: nullableStringSchema,
  items: z.array(purchaseItemSchema).default([]),
  dedication: z
    .object({
      message: nullableStringSchema,
      is_private: z.boolean().nullable().optional(),
      send_physical: z.boolean().nullable().optional(),
      physical_status: nullableStringSchema,
    })
    .nullable()
    .optional(),
  thanks: z
    .object({
      message: nullableStringSchema,
      send_method: nullableStringSchema,
    })
    .nullable()
    .optional(),
  created_at: nullableStringSchema,
});

const ordersDataSchema = z.object({
  orders: z.array(orderSchema),
});

const partitionedOrdersDataSchema = z.object({
  orders: z.unknown().optional(),
  completed_orders: z.unknown().optional(),
  pending_orders: z.unknown().optional(),
  carts: z.unknown().optional(),
});

const giftPurchasesDataSchema = z.object({
  purchases: z.array(giftPurchaseSchema),
});

const fixtureLoginCodeRequestSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('sent'),
    httpStatus: z.number().int().min(100).max(599).optional(),
    requestId: z.string().trim().min(1).nullable().optional(),
  }),
  z.object({
    status: z.enum(['email_not_found', 'rate_limited', 'unavailable', 'failed']),
    error: z.string().trim().min(1),
    httpStatus: z.number().int().min(100).max(599).optional(),
    requestId: z.string().trim().min(1).nullable().optional(),
  }),
]);

const fixtureLoginCodeVerificationSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('authenticated'),
    token: z.string().trim().min(1),
    tokenExpiresAt: z.string().trim().min(1),
    httpStatus: z.number().int().min(100).max(599).optional(),
    requestId: z.string().trim().min(1).nullable().optional(),
  }),
  z.object({
    status: z.enum([
      'invalid_code',
      'email_not_verified',
      'validation_failed',
      'rate_limited',
      'unavailable',
      'failed',
    ]),
    error: z.string().trim().min(1),
    httpStatus: z.number().int().min(100).max(599).optional(),
    requestId: z.string().trim().min(1).nullable().optional(),
  }),
]);

const fixtureEmailAuthSchema = z.object({
  request: fixtureLoginCodeRequestSchema.optional(),
  verify: fixtureLoginCodeVerificationSchema.optional(),
}).strict();

const eventDetailDataSchema = z.object({
  event: eventDetailSchema,
  attendance: attendanceSchema.nullable().default(null),
  purchases: z.array(giftPurchaseSchema).default([]),
});

type OrderWire = z.infer<typeof orderSchema>;
type GiftPurchaseWire = z.infer<typeof giftPurchaseSchema>;
type CartWire = z.infer<typeof cartSchema>;

function normalizePhoneInput(
  input: AgentAuthByPhoneInput,
): AgentAuthByPhoneInput | null {
  const extensionDigits = input.phone_extension.replace(/\D/gu, '');
  const phoneDigits = input.phone_number.replace(/\D/gu, '');
  if (!extensionDigits || !phoneDigits) {
    return null;
  }
  return {
    phone_extension: `+${extensionDigits}`,
    phone_number: phoneDigits,
  };
}

export async function loadFixtureData(
  scenario: string,
  fixturesRoot?: string,
): Promise<FixtureLoadResult> {
  const roots = [
    fixturesRoot,
    path.join(process.cwd(), 'evals', 'fixtures'),
    path.join(process.cwd(), 'dist', 'evals', 'fixtures'),
    path.join(__dirname, '..', '..', 'evals', 'fixtures'),
    path.join(__dirname, '..', 'evals', 'fixtures'),
  ].filter((value): value is string => Boolean(value));

  let lastError: string | null = null;
  for (const root of roots) {
    const filePath = path.join(root, `${scenario}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content) as FixtureData;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { status: 'malformed', scenario, error: `Fixture ${scenario} has invalid JSON shape.` };
      }
      return { status: 'loaded', data: parsed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT') || message.includes('no such file')) {
        lastError = message;
        continue;
      }
      return { status: 'malformed', scenario, error: `Fixture ${scenario} is malformed: ${message}` };
    }
  }
  return { status: 'unknown_scenario', scenario, error: `Unknown fixture scenario "${scenario}". ${lastError ?? ''}`.trim() };
}

export function loadFixtureDataSync(
  scenario: string,
  fixtureData: FixtureData | null | undefined,
  knownScenarios: Set<string> | null,
): FixtureLoadResult {
  if (fixtureData) {
    if (fixtureData === null || typeof fixtureData !== 'object' || Array.isArray(fixtureData)) {
      return { status: 'malformed', scenario, error: `Fixture ${scenario} has invalid shape.` };
    }
    return { status: 'loaded', data: fixtureData };
  }
  if (knownScenarios && !knownScenarios.has(scenario)) {
    return { status: 'unknown_scenario', scenario, error: `Unknown fixture scenario "${scenario}".` };
  }
  return { status: 'unknown_scenario', scenario, error: `Unknown fixture scenario "${scenario}".` };
}

export class FixtureAgentConversationGateway implements AgentConversationGateway {
  readonly capabilityDescriptor: RuntimeCapabilityManifest;
  readonly capabilities: RuntimeCapabilityManifest;
  readonly simulated = true as const;
  readonly fixtureScenario: string;
  readonly runId: string;
  readonly caseId: string;
  private readonly loadResult: FixtureLoadResult;
  private readonly data: FixtureData | null;
  private readonly stateStore: EvalFixtureStateStore;
  private readonly effectReceipts: FixtureEffectReceipt[] = [];
  private readonly rsvpAttendanceByGuest = new Map<number, boolean | null>();

  constructor(
    private readonly scenario: string,
    loadResult: FixtureLoadResult,
    options: FixtureGatewayEffectOptions = {},
  ) {
    this.loadResult = loadResult;
    this.data = loadResult.status === 'loaded' ? loadResult.data : null;
    this.fixtureScenario = scenario;
    this.runId = options.runId?.trim() || 'local-run';
    this.caseId = options.caseId?.trim() || 'local-case';
    this.stateStore = options.stateStore ?? new InMemoryEvalFixtureStateStore();
    const emailAuth = this.data?.emailAuth;
    const hasEmailAuthOutcome = emailAuth !== null &&
      typeof emailAuth === 'object' &&
      !Array.isArray(emailAuth) &&
      ('request' in emailAuth || 'verify' in emailAuth);
    this.capabilityDescriptor = buildRuntimeCapabilityManifest({
      configured: loadResult.status === 'loaded',
      fixture: true,
      environment: 'development',
      disabledOperations: hasEmailAuthOutcome ? [] : ['auth.email_otp'],
      // A fixture is an explicitly isolated test backend. Callers can still
      // deny all mutation capabilities to exercise development isolation.
      allowCustomerWrites: options.allowCustomerWrites ?? true,
    });
    this.capabilities = this.capabilityDescriptor;
  }

  static async create(
    scenario: string,
    fixturesRoot?: string,
    options?: FixtureGatewayEffectOptions,
  ): Promise<FixtureAgentConversationGateway> {
    const result = await loadFixtureData(scenario, fixturesRoot);
    return new FixtureAgentConversationGateway(scenario, result, options);
  }

  static createSync(
    scenario: string,
    fixtureData: FixtureData | null,
    knownScenarios?: Set<string>,
    options?: FixtureGatewayEffectOptions,
  ): FixtureAgentConversationGateway {
    const result = loadFixtureDataSync(scenario, fixtureData ?? null, knownScenarios ?? null);
    return new FixtureAgentConversationGateway(scenario, result, options);
  }

  getFixtureReceipts(): readonly FixtureEffectReceipt[] {
    return [...this.effectReceipts];
  }

  getFixtureCallCount(operation: FixtureEffectReceipt['operation']): number {
    return this.effectReceipts.filter((receipt) => receipt.operation === operation).length;
  }

  getRsvpAttendanceForTesting(guestId: number): boolean | null | undefined {
    return this.rsvpAttendanceByGuest.get(guestId);
  }

  getStateStore(): EvalFixtureStateStore {
    return this.stateStore;
  }

  resetFixtureEffectsForTesting(): void {
    this.effectReceipts.length = 0;
    this.rsvpAttendanceByGuest.clear();
  }

  private unknownScenarioError(): string {
    return `Unknown fixture scenario "${this.scenario}".`;
  }

  private malformedError(): string {
    if (this.loadResult.status === 'malformed') return this.loadResult.error;
    if (this.loadResult.status === 'unknown_scenario') return this.loadResult.error;
    return `Fixture scenario "${this.scenario}" is unavailable.`;
  }

  private isFixtureUnavailable(): boolean {
    return this.loadResult.status !== 'loaded';
  }

  private isWriteBlocked(operation: 'human.takeover.write' | 'rsvp.response.write'): boolean {
    return !this.capabilityDescriptor[operation].available;
  }

  private fixtureEmailAuth(): z.infer<typeof fixtureEmailAuthSchema> | null {
    const parsed = fixtureEmailAuthSchema.safeParse(this.data?.emailAuth);
    return parsed.success ? parsed.data : null;
  }

  async requestUserLoginCode(_email: string): Promise<UserLoginCodeRequestResult> {
    if (this.isFixtureUnavailable()) {
      const result: UserLoginCodeRequestResult = {
        status: 'unavailable',
        error: 'Fixture scenario is unavailable.',
      };
      await this.recordEffect('otp.request', { email: _email }, result.status);
      return result;
    }
    if (!this.capabilityDescriptor['auth.email_otp'].available) {
      const result: UserLoginCodeRequestResult = {
        status: 'unavailable',
        error: 'Email authentication is not configured in this fixture.',
      };
      await this.recordEffect('otp.request', { email: _email }, result.status);
      return result;
    }
    const prior = await this.stateStore.count(this.runId, this.caseId, 'otp.request');
    if (prior >= 1 || this.getFixtureCallCount('otp.request') >= 1) {
      const result: UserLoginCodeRequestResult = {
        status: 'failed',
        error: 'Fixture OTP request already consumed; no resend.',
      };
      await this.recordEffect('otp.request', { email: _email }, result.status);
      return result;
    }
    const configured = this.fixtureEmailAuth();
    if (!configured?.request) {
      const result: UserLoginCodeRequestResult = {
        status: 'unavailable',
        error: 'Email authentication request is not configured in this fixture.',
      };
      await this.recordEffect('otp.request', { email: _email }, result.status);
      return result;
    }
    const parsed = fixtureLoginCodeRequestSchema.safeParse(configured.request);
    if (!parsed.success) {
      const result: UserLoginCodeRequestResult = {
        status: 'failed',
        error: 'Fixture email authentication request outcome had an unexpected shape.',
      };
      await this.recordEffect('otp.request', { email: _email }, result.status);
      return result;
    }
    await this.recordEffect('otp.request', { email: _email }, parsed.data.status);
    return parsed.data;
  }

  async verifyUserLoginCode(
    _email: string,
    _code: string,
  ): Promise<UserLoginCodeVerificationResult> {
    void _code;
    if (this.isFixtureUnavailable()) {
      const result: UserLoginCodeVerificationResult = {
        status: 'unavailable',
        error: 'Fixture scenario is unavailable.',
      };
      await this.recordEffect('otp.verify', { email: _email }, result.status);
      return result;
    }
    if (!this.capabilityDescriptor['auth.email_otp'].available) {
      const result: UserLoginCodeVerificationResult = {
        status: 'unavailable',
        error: 'Email authentication is not configured in this fixture.',
      };
      await this.recordEffect('otp.verify', { email: _email }, result.status);
      return result;
    }
    const prior = await this.stateStore.count(this.runId, this.caseId, 'otp.verify');
    if (prior >= 1 || this.getFixtureCallCount('otp.verify') >= 1) {
      const result: UserLoginCodeVerificationResult = {
        status: 'failed',
        error: 'Fixture OTP verification already consumed.',
      };
      await this.recordEffect('otp.verify', { email: _email }, result.status);
      return result;
    }
    const configured = this.fixtureEmailAuth();
    if (!configured?.verify) {
      const result: UserLoginCodeVerificationResult = {
        status: 'unavailable',
        error: 'Email authentication verification is not configured in this fixture.',
      };
      await this.recordEffect('otp.verify', { email: _email }, result.status);
      return result;
    }
    const parsed = fixtureLoginCodeVerificationSchema.safeParse(configured.verify);
    if (!parsed.success) {
      const result: UserLoginCodeVerificationResult = {
        status: 'failed',
        error: 'Fixture email authentication verification outcome had an unexpected shape.',
      };
      await this.recordEffect('otp.verify', { email: _email }, result.status);
      return result;
    }
    await this.recordEffect('otp.verify', { email: _email }, parsed.data.status);
    return parsed.data;
  }

  private async recordEffect(
    operation: FixtureEffectReceipt['operation'],
    args: Record<string, unknown>,
    resultStatus: string,
  ): Promise<FixtureEffectReceipt> {
    const receipt = await this.stateStore.record({
      runId: this.runId,
      caseId: this.caseId,
      scenario: this.scenario,
      operation,
      args,
      resultStatus,
    });
    this.effectReceipts.push(receipt);
    return receipt;
  }

  private resolveFixtureValue(
    section: 'guestOrders' | 'guestGiftPurchases' | 'guestEvents' | 'eventDetails' | 'rsvp',
    phoneNumber: string,
    extensionKey: string,
  ): unknown {
    if (!this.data) return undefined;
    const sectionData = this.data[section];
    if (!sectionData) return undefined;
    if (Object.prototype.hasOwnProperty.call(sectionData, phoneNumber)) {
      return sectionData[phoneNumber];
    }
    if (Object.prototype.hasOwnProperty.call(sectionData, extensionKey)) {
      return sectionData[extensionKey];
    }
    const extensionDigits = extensionKey.split(':')[0]?.replace(/\D/gu, '') ?? '';
    const concatenatedKey = `${extensionDigits}${phoneNumber}`;
    if (concatenatedKey && Object.prototype.hasOwnProperty.call(sectionData, concatenatedKey)) {
      return sectionData[concatenatedKey];
    }
    return undefined;
  }

  private buildPhoneLookupKeys(phoneInput: string): string[] {
    const keys: string[] = [phoneInput];
    // Try to parse international phone; derive national, extKey, concatenated
    const normalized = phoneInput.replace(/\D/gu, '');
    // Attempt splitInternationalPhone logic without importing full parser to avoid circular; simple heuristic
    // Use the fixture's own normalize path: try known extensions +51, +52, +1
    const candidates: Array<{ ext: string; national: string }> = [];
    if (phoneInput.startsWith('+')) {
      const digits = phoneInput.replace(/\D/gu, '');
      for (const ext of ['52', '51', '1']) {
        if (digits.startsWith(ext)) {
          const national = digits.slice(ext.length);
          if (national.length >= 7) {
            candidates.push({ ext: `+${ext}`, national });
            break;
          }
        }
      }
    } else if (normalized.length >= 11 && normalized.startsWith('51')) {
      // Already concatenated form without '+', treat as concatenated directly
      const national = normalized.slice(2);
      candidates.push({ ext: '+51', national });
    }
    for (const c of candidates) {
      const national = c.national;
      const extKey = `${c.ext}:${national}`;
      const concatenated = `${c.ext.replace(/\D/gu, '')}${national}`;
      if (!keys.includes(national)) keys.push(national);
      if (!keys.includes(extKey)) keys.push(extKey);
      if (concatenated && !keys.includes(concatenated)) keys.push(concatenated);
    }
    // Also ensure raw normalized without '+' is probed if not already
    if (normalized && !keys.includes(normalized)) {
      keys.push(normalized);
    }
    return keys;
  }

  async logMessage(input: AgentMessageLogInput): Promise<AgentGatewayResult> {
    void input;
    if (this.isFixtureUnavailable()) {
      return { status: 'failed', error: this.malformedError(), retryable: false };
    }
    return { status: 'success', message: 'Message logged (fixture).' };
  }

  async getRecentMessages(phoneNumber: string): Promise<
    | { status: 'success'; messages: AgentConversationMessage[] }
    | Exclude<AgentGatewayResult, { status: 'success' }>
  > {
    void phoneNumber;
    if (this.isFixtureUnavailable()) {
      return { status: 'failed', error: this.malformedError(), retryable: false };
    }
    const section = this.data?.['recentMessages' as keyof FixtureData] as Record<string, unknown> | undefined;
    if (!section) {
      return { status: 'success', messages: [] };
    }
    const lookupKeys = this.buildPhoneLookupKeys(phoneNumber);
    let raw: unknown;
    for (const key of lookupKeys) {
      if (Object.prototype.hasOwnProperty.call(section, key)) {
        raw = (section)[key];
        break;
      }
    }
    if (!raw) {
      return { status: 'success', messages: [] };
    }
    const parsed = messagesDataSchema.safeParse(raw);
    if (!parsed.success) {
      return { status: 'failed', error: 'Fixture recentMessages had an unexpected shape.', retryable: false };
    }
    return {
      status: 'success',
      messages: parsed.data.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        source: message.source ?? null,
        body: message.body,
        status: message.status,
        whatsappMessageId: message.whatsapp_message_id ?? null,
        sentAt: message.sent_at ?? null,
        createdAt: message.created_at ?? null,
      })),
    };
  }

  async requestHumanTakeover(phoneNumber: string): Promise<AgentGatewayResult> {
    if (this.isWriteBlocked('human.takeover.write')) {
      return {
        status: 'skipped',
        reason: 'disabled',
        message: 'Customer writes are disabled in this development fixture.',
      };
    }
    if (this.isFixtureUnavailable()) {
      const failed: AgentGatewayResult = { status: 'failed', error: this.malformedError(), retryable: false };
      await this.recordEffect('handoff.write', { phoneNumber }, failed.status);
      return failed;
    }
    const prior = await this.stateStore.count(this.runId, this.caseId, 'handoff.write');
    if (prior >= 1 || this.getFixtureCallCount('handoff.write') >= 1) {
      const replayed = await this.stateStore.lastReceipt(this.runId, this.caseId, 'handoff.write');
      const replay: AgentGatewayResult = {
        status: 'success',
        message: `Human takeover requested (fixture, replay ${replayed?.syntheticId ?? 'unknown'}).`,
      };
      await this.recordEffect('handoff.write', { phoneNumber, replayed: true }, replay.status);
      return replay;
    }
    const configured = (this.data as Record<string, unknown> | null)?.['handoff'];
    if (configured !== undefined && configured !== null && typeof configured === 'object') {
      const record = configured as { status?: unknown; error?: unknown };
      if (record['status'] === 'failed') {
        const failed: AgentGatewayResult = {
          status: 'failed',
          error: typeof record['error'] === 'string' ? record['error'] : 'Fixture handoff failed.',
          retryable: false,
        };
        await this.recordEffect('handoff.write', { phoneNumber }, failed.status);
        return failed;
      }
      if (record['status'] === 'unknown') {
        const failed: AgentGatewayResult = {
          status: 'failed',
          error: 'Fixture handoff outcome is unknown; no automatic retry.',
          retryable: false,
        };
        await this.recordEffect('handoff.write', { phoneNumber }, 'unknown');
        return failed;
      }
    }
    const success: AgentGatewayResult = { status: 'success', message: 'Human takeover requested (fixture).' };
    await this.recordEffect('handoff.write', { phoneNumber }, success.status);
    return success;
  }

  async getOrders(args: { token: string; orderId?: string | null }): Promise<AgentPurchaseLookupResult> {
    void args;
    if (this.isFixtureUnavailable()) {
      return { status: 'failed', resource: 'orders', retryable: false, failureKind: 'invalid_response', error: this.malformedError() };
    }
    return { status: 'failed', resource: 'orders', retryable: false, failureKind: 'invalid_response', error: 'Fixture does not provide authenticated orders.' };
  }

  async getGiftPurchases(args: { token: string; orderId?: string | null }): Promise<AgentPurchaseLookupResult> {
    void args;
    if (this.isFixtureUnavailable()) {
      return { status: 'failed', resource: 'gift_purchases', retryable: false, failureKind: 'invalid_response', error: this.malformedError() };
    }
    return { status: 'failed', resource: 'gift_purchases', retryable: false, failureKind: 'invalid_response', error: 'Fixture does not provide authenticated gift_purchases.' };
  }

  async getGuestOrdersByPhone(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult> {
    return this.getGuestPurchaseByPhone('orders', args);
  }

  async getGuestGiftPurchasesByPhone(args: {
    phone_extension: string;
    phone_number: string;
    orderId?: string | null;
  }): Promise<AgentPhonePurchaseLookupResult> {
    return this.getGuestPurchaseByPhone('gift_purchases', args);
  }

  private async getGuestPurchaseByPhone(
    resource: PurchaseResource,
    args: { phone_extension: string; phone_number: string; orderId?: string | null },
  ): Promise<AgentPhonePurchaseLookupResult> {
    if (this.isFixtureUnavailable()) {
      const error = this.malformedError();
      if (this.loadResult.status === 'unknown_scenario') {
        return { status: 'invalid_response', resource, error };
      }
      return { status: 'invalid_response', resource, error };
    }
    const phone = normalizePhoneInput(args);
    if (!phone) {
      return { status: 'invalid_request', resource, error: 'Agent API phone lookup requires a valid phone identity.' };
    }
    const key = phone.phone_number;
    const extKey = `${phone.phone_extension}:${phone.phone_number}`;
    const sectionKey = resource === 'orders' ? 'guestOrders' : 'guestGiftPurchases';
    const raw = this.resolveFixtureValue(sectionKey as 'guestOrders', key, extKey);

    if (raw === undefined) {
      const fallbackRaw = this.resolveFixtureValue('guestOrders' as const, key, extKey);
      if (resource === 'gift_purchases' && fallbackRaw !== undefined) {
        // Allow gift_purchases fallback to guestOrders if fixture only provides orders partition
      } else if (raw === undefined) {
        return { status: 'not_found', resource, orderId: args.orderId ?? null };
      }
    }

    const effectiveRaw = raw ?? this.resolveFixtureValue('guestOrders' as const, key, extKey);
    if (effectiveRaw === undefined) {
      return { status: 'not_found', resource, orderId: args.orderId ?? null };
    }

    // The fixture stores the raw data object as it appears in HTTP envelope data
    // It may be either { pending_orders: [...], completed_orders: [...], carts: [...] } or legacy { orders: [...] }
    const guestOrders = resource === 'orders' ? this.parseGuestOrders(effectiveRaw) : null;
    const purchases = resource === 'orders'
      ? guestOrders?.purchases ?? null
      : this.parseGiftPurchases(effectiveRaw);

    if (!purchases) {
      return { status: 'invalid_response', resource, error: `Fixture ${this.scenario} ${resource} response had an unexpected shape.` };
    }
    if (resource === 'orders' && guestOrders) {
      return {
        status: 'success',
        resource,
        purchases,
        ...(guestOrders.partitioned
          ? {
              orderPartitions: guestOrders.orderPartitions,
              carts: guestOrders.carts,
            }
          : {}),
      };
    }
    return { status: 'success', resource, purchases };
  }

  async authByPhone(input: AgentAuthByPhoneInput): Promise<AgentAuthByPhoneResult> {
    void input;
    if (this.isFixtureUnavailable()) {
      return { status: 'failed', error: this.malformedError(), retryable: false };
    }
    return { status: 'failed', error: 'Fixture does not provide phone authentication.', retryable: false };
  }

  async updatePhone(args: AgentAuthByPhoneInput & { token: string }): Promise<AgentUpdatePhoneResult> {
    void args;
    if (this.isFixtureUnavailable()) {
      return { status: 'failed', error: this.malformedError(), retryable: false };
    }
    return { status: 'failed', error: 'Fixture does not provide phone update.', retryable: false };
  }

  async getGuestEventsByPhone(input: AgentAuthByPhoneInput): Promise<AgentGuestEventsResult> {
    if (this.isFixtureUnavailable()) {
      return { status: 'failed', error: this.malformedError(), retryable: false };
    }
    const phone = normalizePhoneInput(input);
    if (!phone) {
      return { status: 'failed', error: 'Agent API guest event lookup requires a valid phone identity.', retryable: false };
    }
    const key = phone.phone_number;
    const extKey = `${phone.phone_extension}:${phone.phone_number}`;
    const raw = this.resolveFixtureValue('guestEvents', key, extKey);
    if (raw === undefined) {
      return { status: 'not_found' };
    }
    const parsed = guestEventsDataSchema.safeParse(raw);
    if (!parsed.success) {
      return { status: 'failed', error: 'Fixture guest events response had an unexpected shape.', retryable: false };
    }
    return {
      status: 'success',
      events: parsed.data.events.map((event) => ({
        eventId: event.event_id,
        name: event.name,
        slug: event.slug,
        url: event.url ?? null,
        datetime: normalizeServerTimestamp(event.datetime),
        type: event.type ?? null,
        typeDetail: event.type_detail ?? null,
        stage: event.stage ?? null,
        city: event.city ?? null,
        country: event.country ?? null,
        currency: event.currency ?? null,
      })),
    };
  }

  async getEventDetail(input: {
    eventId?: number;
    slug?: string;
    phone?: AgentAuthByPhoneInput;
    trustedPhone?: AgentAuthByPhoneInput | null;
    phone_extension?: string;
    phone_number?: string;
  }): Promise<AgentEventDetailResult> {
    if (this.isFixtureUnavailable()) {
      return { status: 'failed', error: this.malformedError(), retryable: false };
    }
    const eventId = input.eventId;
    const slug = input.slug?.trim() || null;
    if (eventId === undefined && !slug) {
      return { status: 'failed', error: 'Agent API event detail lookup requires an event id or slug.', retryable: false };
    }
    if (eventId !== undefined && (!Number.isSafeInteger(eventId) || eventId <= 0)) {
      return { status: 'failed', error: 'Agent API event detail lookup received an invalid event id.', retryable: false };
    }
    const hasDirectPhone = input.phone_extension !== undefined || input.phone_number !== undefined;
    const suppliedPhone = input.trustedPhone ?? input.phone ?? (hasDirectPhone
      ? {
          phone_extension: input.phone_extension ?? '',
          phone_number: input.phone_number ?? '',
        }
      : null);
    if (hasDirectPhone && (!input.phone_extension || !input.phone_number)) {
      return { status: 'failed', error: 'Agent API event detail phone lookup requires both phone fields.', retryable: false };
    }
    const phone = suppliedPhone ? normalizePhoneInput(suppliedPhone) : null;
    if (suppliedPhone && !phone) {
      return { status: 'failed', error: 'Agent API event detail lookup received an invalid phone identity.', retryable: false };
    }

    const key = eventId !== undefined ? String(eventId) : `slug:${slug}`;
    const raw = (this.data?.eventDetails)?.[key];
    if (raw === undefined) {
      const allDetails = this.data?.eventDetails;
      if (allDetails && Object.keys(allDetails).length === 0) {
        return { status: 'not_found' };
      }
      if (!allDetails) {
        return { status: 'not_found' };
      }
      // Try to find by eventId numeric match
      const foundKey = Object.keys(allDetails).find((k) => k === String(eventId));
      if (!foundKey) {
        return { status: 'not_found' };
      }
      const foundRaw = allDetails[foundKey];
      const parsed = eventDetailDataSchema.safeParse(foundRaw);
      if (!parsed.success) {
        return { status: 'failed', error: 'Fixture event detail response had an unexpected shape.', retryable: false };
      }
      return this.mapEventDetail(parsed.data, phone);
    }

    const parsed = eventDetailDataSchema.safeParse(raw);
    if (!parsed.success) {
      return { status: 'failed', error: 'Fixture event detail response had an unexpected shape.', retryable: false };
    }
    return this.mapEventDetail(parsed.data, phone);
  }

  private mapEventDetail(
    parsed: z.infer<typeof eventDetailDataSchema>,
    _phone: AgentAuthByPhoneInput | null,
  ): AgentEventDetailResult {
    void _phone;
    const event = parsed.event;
    return {
      status: 'success',
      event: {
        eventId: event.event_id,
        name: event.name,
        slug: event.slug,
        url: event.url ?? null,
        datetime: normalizeServerTimestamp(event.datetime),
        type: event.type ?? null,
        typeDetail: event.type_detail ?? null,
        stage: event.stage ?? null,
        city: event.city ?? null,
        country: event.country?.name ?? null,
        currency: event.currency ?? null,
        withTime: event.with_time,
        timezone: event.timezone ?? null,
        celebrateds: event.celebrateds.map((celebrated) => ({
          name: celebrated.name,
          type: celebrated.type ?? null,
        })),
        moments: event.moments.map((moment) => ({
          label: moment.label,
          description: moment.description ?? null,
          datetime: normalizeServerTimestamp(moment.datetime),
          withTime: moment.with_time,
          locationDescription: moment.location_description ?? null,
          locationReference: moment.location_reference ?? null,
          locationUrl: moment.location_url ?? null,
          locationCoords: moment.location_coords ?? null,
          position: moment.position,
        })),
        dresscode: event.dresscode
          ? {
              type: event.dresscode.type ?? null,
              description: event.dresscode.description ?? null,
            }
          : null,
        commonAsked: event.common_asked,
        contactInfo: Array.isArray(event.contact_info)
          ? event.contact_info
          : Object.entries(event.contact_info)
              .filter((entry): entry is [string, string] => entry[1] !== null)
              .map(([label, value]) => ({ label, value })),
        attendance: parsed.attendance
          ? {
              guestId: parsed.attendance.guest_id,
              name: parsed.attendance.name,
              hasResponded: parsed.attendance.has_responded === true || parsed.attendance.has_responded === 1,
              willAttend: parsed.attendance.will_attend === null
                ? null
                : parsed.attendance.will_attend === true || parsed.attendance.will_attend === 1,
              responseDate: normalizeServerTimestamp(parsed.attendance.response_date),
            }
          : null,
        purchases: parsed.purchases.map((purchase) => this.mapGiftPurchase(purchase)),
      },
    };
  }

  async guestRsvp(input: AgentGuestRsvpInput): Promise<AgentGuestRsvpResult> {
    if (this.isFixtureUnavailable()) {
      const failed: AgentGuestRsvpResult = { status: 'failed', error: this.malformedError(), retryable: false };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, failed.status);
      return failed;
    }
    if (this.isWriteBlocked('rsvp.response.write')) {
      const failed: AgentGuestRsvpResult = { status: 'failed', error: 'Customer writes are disabled in this development fixture.', retryable: false };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, failed.status);
      return failed;
    }
    const phone = normalizePhoneInput(input);
    if (!phone) {
      return { status: 'failed', error: 'Agent API RSVP requires a valid phone identity.', retryable: false };
    }
    if (!input.action && !input.plus_one_response) {
      return { status: 'failed', error: 'Agent API RSVP requires an attendance or plus-one decision.', retryable: false };
    }
    if (input.plus_one_response &&
      (input.guest_id === undefined || !Number.isInteger(input.guest_id) || input.guest_id <= 0)) {
      return { status: 'failed', error: 'Agent API plus-one RSVP requires a valid guest id.', retryable: false };
    }

    const key = phone.phone_number;
    const extKey = `${phone.phone_extension}:${phone.phone_number}`;
    const concatenatedKey = `${phone.phone_extension.replace(/\D/gu, '')}${phone.phone_number}`;
    const rsvpSection = this.data?.rsvp;
    let rawData: unknown;
    let httpStatus: number | null = 200;
    let errorCode: string | null = null;

    if (rsvpSection) {
      // Try direct phone key lookup for simple fixture shapes
      const phoneFixture = (rsvpSection[key] ?? rsvpSection[extKey] ?? rsvpSection[concatenatedKey]) as Record<string, unknown> | undefined;
      if (phoneFixture) {
        // phoneFixture may be { responses: [...] } or direct data
        if (Array.isArray((phoneFixture)['responses'])) {
          const responses = (phoneFixture as { responses: Array<{ match: Record<string, unknown>; response: { httpStatus?: number; data?: unknown; errorCode?: string; error?: string } }> }).responses;
          let matched: typeof responses[number] | undefined;
          for (const entry of responses) {
            const m = entry.match;
            let ok = true;
            if (m['guest_id'] !== undefined && m['guest_id'] !== input.guest_id) ok = false;
            if (m['action'] !== undefined && m['action'] !== input.action) ok = false;
            if (m['plus_one_response'] !== undefined && m['plus_one_response'] !== input.plus_one_response) ok = false;
            if (m['plus_one_name'] !== undefined && m['plus_one_name'] !== input.plus_one_name) ok = false;
            if (ok) { matched = entry; break; }
          }
          if (matched) {
            rawData = matched.response.data;
            httpStatus = matched.response.httpStatus ?? 200;
            errorCode = matched.response.errorCode ?? null;
            if (matched.response.error && httpStatus !== 200) {
              // treat as failure path
            }
          } else if ((phoneFixture)['default']) {
            const def = (phoneFixture)['default'] as { data?: unknown; httpStatus?: number; errorCode?: string };
            rawData = def.data;
            httpStatus = def.httpStatus ?? 200;
            errorCode = def.errorCode ?? null;
          }
        } else if ((phoneFixture)['data'] !== undefined || (phoneFixture)['pending_guests'] !== undefined) {
          rawData = phoneFixture;
        } else {
          // phoneFixture itself is the raw data envelope
          rawData = phoneFixture;
        }
      } else {
        // Check top-level rsvp keys that are not phone-specific (e.g., single scenario with one phone)
        // If rsvpSection has a direct pending_guests or plus_one, treat as rawData for any phone
        if (Object.prototype.hasOwnProperty.call(rsvpSection, 'pending_guests') ||
            Object.prototype.hasOwnProperty.call(rsvpSection, 'candidates') ||
            Object.prototype.hasOwnProperty.call(rsvpSection, 'plus_one') ||
            Object.prototype.hasOwnProperty.call(rsvpSection, 'guest_id')) {
          rawData = rsvpSection;
        } else if (typeof rsvpSection === 'object' && rsvpSection !== null && 'data' in rsvpSection) {
          const envelope = rsvpSection as { data?: unknown; httpStatus?: number; errorCode?: string };
          rawData = envelope.data;
          httpStatus = envelope.httpStatus ?? 200;
          errorCode = envelope.errorCode ?? null;
        }
      }

      if (rawData === undefined && Object.prototype.hasOwnProperty.call(rsvpSection, 'data')) {
        const envelope = rsvpSection as { data?: unknown; httpStatus?: number; errorCode?: string };
        if (envelope.data !== undefined) {
          rawData = envelope.data;
          httpStatus = envelope.httpStatus ?? 200;
          errorCode = envelope.errorCode ?? null;
        }
      }
    }

    if (rawData === undefined) {
      // No fixture entry -> fail with invalid_response (typed fail-closed, not crash)
      const failed: AgentGuestRsvpResult = { status: 'failed', error: `Fixture scenario "${this.scenario}" missing RSVP response for phone ${key}.`, retryable: false };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, failed.status);
      return failed;
    }

    // Simulate HttpAgentConversationGateway's post-request parsing for both success and failure branches
    // If rawData is a candidate envelope, return multiple_pending regardless of status
    const candidates = this.parseRsvpCandidates(rawData);
    if (candidates) {
      const result: AgentGuestRsvpResult = { status: 'multiple_pending', candidates };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, result.status);
      return result;
    }
    if (errorCode === 'multiple_pending') {
      return { status: 'failed', error: 'Agent API RSVP multiple-pending response had an unexpected shape.', retryable: false };
    }

    if (httpStatus === 404) {
      const result: AgentGuestRsvpResult = { status: 'no_pending' };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, result.status);
      return result;
    }
    if (httpStatus === 403 || errorCode === 'phone_mismatch') {
      const result: AgentGuestRsvpResult = { status: 'phone_mismatch' };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, result.status);
      return result;
    }
    if (errorCode === 'already_responded') {
      const result: AgentGuestRsvpResult = {
        status: 'already_responded',
        currentAction: null,
        requestedAction: input.action ?? null,
        guestId: input.guest_id ?? null,
        eventName: null,
        eventDate: null,
      };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, result.status);
      return result;
    }
    if (httpStatus !== 200 && httpStatus !== null) {
      const result: AgentGuestRsvpResult = { status: 'failed', error: (rawData as Record<string, unknown>)['error'] as string ?? `Fixture RSVP failed with ${httpStatus}`, retryable: httpStatus >= 500 };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, result.status);
      return result;
    }

    // Success path: parse as rsvp response
    const rawObject = rawData;
    const combined = rsvpCombinedResponseDataSchema.safeParse(rawObject);
    const isCombined =
      rawObject !== null &&
      typeof rawObject === 'object' &&
      !Array.isArray(rawObject) &&
      ('rsvp' in (rawObject as Record<string, unknown>) || 'plus_one' in (rawObject as Record<string, unknown>));
    const parsed = rsvpResponseDataSchema.safeParse(
      isCombined && combined.success
        ? {
            ...(combined.data.rsvp ?? (rawObject as Record<string, unknown>)),
            plus_one: combined.data.plus_one ?? null,
          }
        : rawObject,
    );
    if (!parsed.success) {
      const failed: AgentGuestRsvpResult = { status: 'failed', error: 'Agent API RSVP response had an unexpected shape.', retryable: false };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, failed.status);
      return failed;
    }
    const plusOne = parsed.data.plus_one ?? null;
    if (input.plus_one_response && !plusOne) {
      const failed: AgentGuestRsvpResult = { status: 'failed', error: 'Agent API RSVP response did not confirm the plus-one state.', retryable: false };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, failed.status);
      return failed;
    }
    const expectedWillAttend = input.action === 'attending';
    const returnedWillAttend = parsed.data.will_attend === true || parsed.data.will_attend === 1
      ? true
      : parsed.data.will_attend === false || parsed.data.will_attend === 0
        ? false
        : null;
    if (input.action && (returnedWillAttend === null || returnedWillAttend !== expectedWillAttend)) {
      const failed: AgentGuestRsvpResult = { status: 'failed', error: 'Agent API RSVP response did not confirm the requested attendance state.', retryable: false };
      await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, failed.status);
      return failed;
    }
    const responded: AgentGuestRsvpResult = {
      status: 'responded',
      action: parsed.data.action ?? input.action ?? null,
      willAttend: returnedWillAttend,
      guestId: parsed.data.guest_id ?? input.guest_id ?? null,
      eventName: parsed.data.event_name ?? parsed.data.event?.name ?? parsed.data.event?.title ?? null,
      eventDate: normalizeServerTimestamp(
        parsed.data.event_date ?? parsed.data.event?.date ?? parsed.data.event?.event_date,
      ),
      plusOne: plusOne
        ? {
            saved: plusOne.saved,
            response: plusOne.response ?? input.plus_one_response ?? null,
            reason: plusOne.reason ?? null,
          }
        : null,
    };
    if (responded.status === 'responded' && responded.guestId !== null) {
      this.rsvpAttendanceByGuest.set(responded.guestId, responded.willAttend);
    }
    await this.recordEffect('rsvp.write', { guest_id: input.guest_id ?? null, action: input.action ?? null }, responded.status);
    return responded;
  }

  private parseRsvpCandidates(data: unknown): RsvpCandidate[] | null {
    const parsed = rsvpCandidateEnvelopeSchema.safeParse(data);
    if (!parsed.success) {
      return null;
    }
    const candidateData: RsvpCandidateWire[] = Array.isArray(parsed.data)
      ? parsed.data
      : 'pending_guests' in parsed.data
        ? parsed.data.pending_guests as RsvpCandidateWire[]
        : 'candidates' in parsed.data
        ? parsed.data.candidates as RsvpCandidateWire[]
        : 'pending' in parsed.data
          ? parsed.data.pending as RsvpCandidateWire[]
          : parsed.data.invitations;
    return candidateData.map((candidate) => ({
      guestId: candidate.guest_id,
      eventName: candidate.event_name ?? candidate.event?.name ?? candidate.event?.title ?? null,
      eventDate: normalizeServerTimestamp(
        candidate.event_date ?? candidate.event?.date ?? candidate.event?.event_date,
      ),
    }));
  }

  private parseOrders(data: unknown): PurchaseInformation[] | null {
    const parsed = ordersDataSchema.safeParse(data);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.orders.map((order) => this.mapOrder(order, 'legacy_orders'));
  }

  private parseGuestOrders(data: unknown): {
    purchases: PurchaseInformation[];
    orderPartitions: { pending: PurchaseInformation[]; completed: PurchaseInformation[] };
    carts: CartInformation[];
    partitioned: boolean;
  } | null {
    const parsed = partitionedOrdersDataSchema.safeParse(data);
    if (!parsed.success || !data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    const source = data as Record<string, unknown>;
    const partitioned =
      Object.prototype.hasOwnProperty.call(source, 'completed_orders') ||
      Object.prototype.hasOwnProperty.call(source, 'pending_orders') ||
      Object.prototype.hasOwnProperty.call(source, 'carts');
    if (!partitioned) {
      if (!Object.prototype.hasOwnProperty.call(source, 'orders')) {
        return null;
      }
      const legacy = ordersDataSchema.safeParse(data);
      if (!legacy.success) return null;
      const purchases = legacy.data.orders.map((order) => this.mapOrder(order, 'legacy_orders'));
      return {
        purchases,
        orderPartitions: { pending: [], completed: [] },
        carts: [],
        partitioned: false,
      };
    }
    const pendingParsed = Object.prototype.hasOwnProperty.call(source, 'pending_orders')
      ? z.array(orderSchema).safeParse(source.pending_orders)
      : { success: true as const, data: [] as OrderWire[] };
    const completedParsed = Object.prototype.hasOwnProperty.call(source, 'completed_orders')
      ? z.array(orderSchema).safeParse(source.completed_orders)
      : { success: true as const, data: [] as OrderWire[] };
    const cartsParsed = Object.prototype.hasOwnProperty.call(source, 'carts')
      ? z.array(cartSchema).safeParse(source.carts)
      : { success: true as const, data: [] as CartWire[] };
    if (!pendingParsed.success || !completedParsed.success || !cartsParsed.success) {
      return null;
    }
    const pending = pendingParsed.data.map((order) => this.mapOrder(order, 'pending_orders'));
    const completed = completedParsed.data.map((order) => this.mapOrder(order, 'completed_orders'));
    const carts = cartsParsed.data.map((cart) => this.mapCart(cart));
    return {
      purchases: [...pending, ...completed],
      orderPartitions: { pending, completed },
      carts,
      partitioned: true,
    };
  }

  private mapOrder(order: OrderWire, partition: PurchasePartition): PurchaseInformation {
    return {
      orderId: order.id,
      partition,
      eventId: order.event_id ?? null,
      currency: order.currency ?? null,
      customerTransactionNumber: normalizeBackendCustomerTransactionNumber(order.increment_id),
      paymentStatus: order.payment_status ?? null,
      shippingStatus: order.shipping_status ?? null,
      grandTotal: order.grand_total ?? null,
      paymentMethod: order.payment_method ?? null,
      eventName: order.event_name ?? null,
      eventDate: normalizeServerTimestamp(order.event_date),
      eventUrl: order.event_url ?? null,
      createdAt: normalizeServerTimestamp(order.created_at),
      items: order.items.map((item) => ({
        giftName: item.gift_name ?? null,
        quantity: item.quantity ?? null,
        amount: item.amount ?? null,
        rowTotal: item.row_total ?? null,
        type: item.type ?? null,
      })),
    };
  }

  private mapCart(cart: CartWire): CartInformation {
    return {
      cartId: String(cart.cart_id),
      status: cart.status,
      wasAbandoned: cart.was_abandoned,
      eventId: cart.event_id ?? null,
      eventName: cart.event_name ?? null,
      eventDate: normalizeServerTimestamp(cart.event_date),
      eventUrl: cart.event_url ?? null,
      subtotal: cart.subtotal ?? null,
      giftsQuantity: cart.gifts_quantity ?? null,
      createdAt: normalizeServerTimestamp(cart.created_at),
      items: cart.items.map((item) => ({
        giftName: item.gift_name ?? null,
        quantity: item.quantity ?? null,
        amount: item.amount ?? null,
        rowTotal: item.row_total ?? null,
        type: item.type ?? null,
      })),
    };
  }

  private parseGiftPurchases(data: unknown): PurchaseInformation[] | null {
    const parsed = giftPurchasesDataSchema.safeParse(data);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.purchases.map((purchase) => this.mapGiftPurchase(purchase));
  }

  private mapGiftPurchase(purchase: GiftPurchaseWire): PurchaseInformation {
    return {
      orderId: purchase.id,
      eventId: purchase.event_id ?? null,
      currency: purchase.currency ?? null,
      customerTransactionNumber: normalizeBackendCustomerTransactionNumber(purchase.increment_id),
      paymentStatus: purchase.payment_status ?? null,
      shippingStatus: purchase.shipping_status ?? null,
      grandTotal: purchase.grand_total ?? null,
      paymentMethod: purchase.payment?.method ?? null,
      eventName: purchase.event_name ?? null,
      eventDate: normalizeServerTimestamp(purchase.event_date),
      eventUrl: purchase.event_url ?? null,
      createdAt: normalizeServerTimestamp(purchase.created_at),
      items: purchase.items.map((item) => ({
        giftName: item.gift_name ?? null,
        quantity: item.quantity ?? null,
        amount: item.amount ?? null,
        rowTotal: item.row_total ?? null,
        type: item.type ?? null,
      })),
      payment: purchase.payment
        ? {
            method: purchase.payment.method ?? null,
            amount: purchase.payment.amount ?? null,
            paidAt: normalizeServerTimestamp(purchase.payment.paid_at),
            paymentId: purchase.payment.payment_id ?? null,
            transactionStatus: purchase.payment.transaction_status ?? null,
            gatewayMessage: purchase.payment.gateway_message ?? null,
            operationCode: purchase.payment.op_code ?? null,
            originBank: purchase.payment.origin_bank ?? null,
            destinationAccount: purchase.payment.destination_account
              ? {
                  holder: purchase.payment.destination_account.holder ?? null,
                  bank: purchase.payment.destination_account.bank ?? null,
                  number: purchase.payment.destination_account.number ?? null,
                  cci: purchase.payment.destination_account.cci ?? null,
                  type: purchase.payment.destination_account.type ?? null,
                }
              : null,
            voucherImage: purchase.payment.voucher ?? null,
          }
        : null,
      declineCode: purchase.decline_code ?? null,
      adminComment: purchase.admin_comment ?? null,
      dedication: purchase.dedication
        ? {
            message: purchase.dedication.message ?? null,
            isPrivate: purchase.dedication.is_private ?? null,
            sendPhysical: purchase.dedication.send_physical ?? null,
            physicalStatus: purchase.dedication.physical_status ?? null,
          }
        : null,
      thanks: purchase.thanks
        ? {
            message: purchase.thanks.message ?? null,
            sendMethod: purchase.thanks.send_method ?? null,
          }
        : null,
      isThanked: purchase.is_thanked ?? null,
    };
  }
}
