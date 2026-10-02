import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { PersistedPlan } from '../src/core/plan';
import type { InformationTaskResult } from '../src/core/information';
import type { ComposeReplyRequest, ExtractionResult } from '../src/runtime/contracts';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';

const CITATION = 'https://sinenvolturas.tawk.help/article/cuanto-cuesta';

function testRuntime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'test-key',
    replyModel: 'gpt-test',
    extractorModel: 'gpt-test',
    replyProviderLimit: 4,
    presentationProviderLimit: 5,
    providerDetailLookupLimit: 3,
    promptLoader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    providerGateway: {
      async searchProviders(): Promise<never> {
        throw new Error('construction must not call the provider gateway');
      },
    } as never,
  });
}

function faqPlan(): PersistedPlan {
  return mergePlan(
    createEmptyPlan({ planId: 'faq-economy', channel: 'whatsapp', externalUserId: 'faq-user' }),
    { current_node: 'resolver_consultas_informativas' },
  ) as PersistedPlan;
}

function faqExtraction(): ExtractionResult {
  return {
    requestedOperation: 'faq.read',
    informationRequests: [{ kind: 'faq', query: '¿Cuánto cobran de comisión?' }],
  } as unknown as ExtractionResult;
}

function faqResult(): InformationTaskResult {
  return {
    requestId: 'information-1',
    kind: 'faq',
    status: 'completed',
    evidence: [{
      fileId: 'file-top',
      filename: 'cuanto-cuesta.md',
      score: 0.893,
      text: '# ¿Cuánto cuesta?\n\nCrearte una cuenta es gratis.',
      fullArticle: true,
      sourceUrl: CITATION,
    }],
    citationUrl: CITATION,
  };
}

function replyRequest(informationResults: InformationTaskResult[]): ComposeReplyRequest {
  return {
    currentNode: 'resolver_consultas_informativas',
    previousNode: 'contacto_inicial',
    userMessage: '¿Cuánto cobran de comisión?',
    messageContext: localTurnMessageContext('not_configured'),
    plan: faqPlan(),
    extraction: faqExtraction(),
    missingFields: [],
    searchReady: false,
    providerResults: [],
    turnDecision: null,
    informationResults,
    toolUsage: { considered: [], inputs: [], outputs: [] },
  } as unknown as ComposeReplyRequest;
}

describe('FAQ prompt economy', () => {
  it('admits an over-budget first passage whole instead of empty evidence', async () => {
    const oversized = faqResult();
    const first = oversized.status === 'completed' && oversized.kind === 'faq'
      ? oversized.evidence[0]
      : undefined;
    if (first) first.text = `${'# Título'}\n\n${'x'.repeat(7_000)}`;
    const spec = await testRuntime().buildReplyRequestSpec(replyRequest([oversized]));
    const input = JSON.parse(spec.input.slice(spec.input.indexOf('{'))) as {
      information_results: Array<{
        coverage: string;
        evidence: Array<{ text: string }>;
      }>;
    };
    const result = input.information_results[0];
    expect(result?.coverage).toBe('partial');
    expect(result?.evidence).toHaveLength(1);
    expect(result?.evidence[0]?.text).toContain('x'.repeat(7_000));
  });

  it('withholds the citation URL from model input so the footer stays deterministic', async () => {
    const spec = await testRuntime().buildReplyRequestSpec(replyRequest([faqResult()]));
    // The evidence itself must be present (no vacuous pass on empty
    // projection) while the typed result still carries the citation for
    // the delivery chain; the model just never sees the link it must not
    // generate.
    expect(spec.input).toContain('¿Cuánto cuesta?');
    expect(spec.input).not.toContain('tawk.help');
    expect(spec.input).not.toContain('citationUrl');
  });
});
