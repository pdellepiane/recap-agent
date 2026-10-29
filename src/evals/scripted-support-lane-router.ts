/**
 * The scripted Decisions router of the offline evaluation harness.
 *
 * The offline target replays stored evidence with no model and no network.
 * A case that exercises the customer-assistance lane therefore needs the
 * router's answers to be typed data: this port states the three typed facts
 * of a turn (route, same open request, request settled) and lets the
 * deterministic policy decide the lane, exactly as the production router does.
 *
 * The port is a narrow seam: it never reads the customer message and never
 * writes a reply.
 */
import { currentOpenRequest } from '../core/open-request';
import type { RouterDecisionTrace } from '../core/trace';
import type { OpenAiCallRef, TokenUsage } from '../runtime/contracts';
import {
  toRouterDecisionTrace,
  type RouterParsedAnswers,
} from '../runtime/decisions-router-client';
import type { RouterInputArgs } from '../runtime/decisions-router-input';
import {
  decideRouterPolicy,
  type RouterPolicyOutcome,
} from '../runtime/decisions-router-policy';
import type { RouterRoute } from '../runtime/decisions-router-questions';
import type {
  SupportLaneRouterPort,
  SupportLaneRouterResult,
} from '../runtime/decisions-router-lane';

/** One scripted router answer: the three facts the router states. */
export type ScriptedRouterAnswer = {
  readonly route: RouterRoute;
  readonly sameOpenRequest: boolean;
  readonly selectedRequestKey?: string | null;
  readonly requestSettled: boolean;
};

/** The scripted answers of one offline case, in turn order. */
export type ScriptedRouterAnswers = {
  readonly answers: readonly ScriptedRouterAnswer[];
  /** Repeats the last answer once the list is exhausted. */
  readonly repeatLast?: boolean;
};

/**
 * The scripted router port.
 *
 * With no scripted answers the port is disabled: the turn keeps the
 * classifier path, so an offline case that does not declare router answers
 * behaves exactly as before.
 */
export class ScriptedSupportLaneRouter implements SupportLaneRouterPort {
  readonly enabled: boolean;

  readonly inputs: RouterInputArgs[] = [];

  private index = 0;

  constructor(private readonly scripted: ScriptedRouterAnswers) {
    this.enabled = scripted.answers.length > 0;
  }

  async run(args: RouterInputArgs): Promise<SupportLaneRouterResult> {
    this.inputs.push(args);
    const answers = this.scripted.answers;
    const answer = answers[Math.min(this.index, answers.length - 1)];
    this.index += 1;
    if (answer === undefined) {
      return {
        status: 'unavailable',
        reason: 'no_scripted_answers',
        retryable: false,
      };
    }
    const selectedKey = answer.selectedRequestKey ?? (answer.sameOpenRequest ? currentOpenRequest(args.plan.open_requests)?.key ?? null : null);
    const parsed = { ...parsedFromAnswer(answer), selectedRequestKey: selectedKey };
    const current = args.plan.open_requests.find((request) => request.key === selectedKey) ?? null;
    const outcome: RouterPolicyOutcome = decideRouterPolicy({
      route: parsed.route,
      sameOpenRequest: parsed.sameOpenRequest,
      current,
      requestSettled: parsed.requestSettled,
      takeoverConfirmed: args.plan.human_help_receipt?.outcome === 'handoff_requested',
      helpOfferPending: args.plan.conversation_health.help_offer_status === 'offered',
    });
    return {
      status: 'ok',
      outcome,
      answers: parsed,
      current,
      sameOpenRequest: parsed.sameOpenRequest,
      recordFactsAnswered: true,
      decision: toRouterDecisionTrace(parsed),
      call: scriptedRouterCallRef(),
      tokenUsage: scriptedRouterTokenUsage(),
    };
  }
}

/** The call reference of a scripted router turn. */
function scriptedRouterCallRef(): OpenAiCallRef {
  return {
    responseId: 'router-scripted-offline',
    requestId: null,
    model: 'gpt-6-luna',
    attemptCount: 1,
    requestMetrics: {
      instructionBytes: 0,
      inputBytes: 0,
      toolCount: 0,
      schemaPropertyCount: 3,
      transport: {
        observedRequestCount: 1,
        totalPayloadBytes: 0,
        instructionBytes: 0,
        inputBytes: 0,
        toolBytes: 0,
        outputSchemaBytes: 0,
        requests: [],
      },
    },
  };
}

function scriptedRouterTokenUsage(): TokenUsage {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
}

/** The redacted decision evidence of a scripted router turn. */
export function scriptedRouterDecision(
  answer: ScriptedRouterAnswer,
): RouterDecisionTrace {
  return toRouterDecisionTrace(parsedFromAnswer(answer));
}

/**
 * A scripted answer as the router client would have parsed it: one certain
 * route and one certain value for each of the two record facts.
 */
function parsedFromAnswer(answer: ScriptedRouterAnswer): RouterParsedAnswers {
  return {
    route: answer.route,
    routeProbabilities: [{ value: answer.route, probability: 1 }],
    sameOpenRequest: answer.sameOpenRequest,
    selectedRequestKey: answer.selectedRequestKey ?? null,
    sameOpenRequestProbability: answer.sameOpenRequest ? 1 : 0,
    requestSettled: answer.requestSettled,
    requestSettledProbability: answer.requestSettled ? 1 : 0,
    refusals: [],
  };
}
