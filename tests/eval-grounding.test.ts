import { describe, expect, it } from 'vitest';

import type { EvalArtifactTurnResult } from '../src/evals/case-schema';
import { assessGrounding } from '../src/evals/grounding';

function recommendationTurn(args: {
  providerId: number;
  evidenceProviderId?: number;
  category?: string;
  evidenceCategory?: string;
  }): EvalArtifactTurnResult {
  return {
    trace: {
      provider_results: [{
        id: args.providerId,
        title: 'Provider',
        category: args.category ?? 'Catering',
        location: 'Lima, Perú',
      }],
      provider_candidate_audit: [{
        provider_id: args.evidenceProviderId ?? args.providerId,
        category: args.evidenceCategory ?? args.category ?? 'Catering',
        location: 'Lima, Perú',
        retrieval_source: 'api',
        retrieval_score: null,
        fit_score: 90,
      }],
      next_node: 'recomendar',
      information_execution_summary: [],
      close_action_summary: { type: null, category: null, reason_preview: null },
    },
  } as unknown as EvalArtifactTurnResult;
}

describe('deterministic grounding assessment', () => {
  it('passes a recommendation backed by matching structured evidence', () => {
    const result = assessGrounding(recommendationTurn({ providerId: 10 }));
    expect(result.grounded).toBe(true);
    expect(result.verifiedProviderCount).toBe(1);
  });

  it('fails missing provider evidence and attribute mismatches', () => {
    const missing = assessGrounding(
      recommendationTurn({ providerId: 10, evidenceProviderId: 11 }),
    );
    expect(missing.grounded).toBe(false);
    expect(missing.unsupportedProviderIds).toEqual([10]);

    const mismatch = assessGrounding(recommendationTurn({
      providerId: 10,
      category: 'Catering',
      evidenceCategory: 'Locales',
    }));
    expect(mismatch.grounded).toBe(false);
    expect(mismatch.attributeMismatches).toBe(1);
  });

  it('grounds FAQ turns only when knowledge retrieval completed with evidence', () => {
    const turn = {
      trace: {
        provider_results: [],
        provider_candidate_audit: [],
        next_node: 'resolver_consultas_informativas',
        information_execution_summary: [
          {
            requestId: 'information-1',
            kind: 'faq',
            status: 'completed',
            source: 'knowledge_base',
            resultCount: 2,
            durationMs: 20,
          },
        ],
        close_action_summary: {
          type: null,
          category: null,
          reason_preview: null,
        },
      },
    } as unknown as EvalArtifactTurnResult;

    expect(assessGrounding(turn)).toMatchObject({
      turnClass: 'factual_faq',
      groundingRequired: true,
      grounded: true,
    });
  });
});
