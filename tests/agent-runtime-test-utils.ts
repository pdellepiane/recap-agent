import type {
  AgentRuntime,
  ComposeReplyRequest,
  ComposeReplyResult,
  ExtractRequest,
  ExtractionResult,
} from '../src/runtime/contracts';

/** Compose behavior injected into a stub runtime. */
export type StubComposeFn = (request: ComposeReplyRequest) => ComposeReplyResult;

/** Fixed-text reply composer. */
export function fixedTextReply(text: string): StubComposeFn {
  return () => ({ text });
}

/** `reply:<currentNode>` composer for node-routing assertions. */
export function nodeReply(prefix = 'reply:'): StubComposeFn {
  return (request) => ({ text: `${prefix}${request.currentNode}` });
}

/** Echoes the request error message, falling back when absent. */
export function echoErrorMessage(fallback: string): StubComposeFn {
  return (request) => ({ text: request.errorMessage ?? fallback });
}

/** Sentinel reply with a generic single-paragraph structured message. */
export function sentinelReply(sentinel: string): StubComposeFn {
  return () => ({
    text: sentinel,
    structuredMessage: { type: 'generic', paragraphs_es: [sentinel] },
  });
}

/**
 * Indexed scripted extractions; repeats the last fixture once the queue is
 * exhausted. Tracks extract and compose requests for assertions.
 */
export class ScriptedAgentRuntime implements AgentRuntime {
  readonly extractRequests: ExtractRequest[] = [];
  readonly composeRequests: ComposeReplyRequest[] = [];
  private index = 0;

  constructor(
    private readonly extractions: ExtractionResult[],
    private readonly compose: StubComposeFn = fixedTextReply('Respuesta informativa.'),
  ) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    this.extractRequests.push(request);
    const next = this.extractions[this.index] ?? this.extractions[this.extractions.length - 1];
    this.index += 1;
    if (!next) throw new Error('Missing extraction fixture.');
    return next;
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return this.compose(request);
  }
}

/**
 * Shift-based scripted extractions; throws once the queue is exhausted.
 * Tracks compose requests for assertions.
 */
export class QueuedAgentRuntime implements AgentRuntime {
  readonly composeRequests: ComposeReplyRequest[] = [];

  constructor(
    private readonly extractions: ExtractionResult[],
    private readonly compose: StubComposeFn,
    private readonly emptyError = 'No extraction queued',
  ) {}

  async extract(request: ExtractRequest): Promise<ExtractionResult> {
    void request;
    const next = this.extractions.shift();
    if (!next) throw new Error(this.emptyError);
    return next;
  }

  async composeReply(request: ComposeReplyRequest): Promise<ComposeReplyResult> {
    this.composeRequests.push(request);
    return this.compose(request);
  }
}
