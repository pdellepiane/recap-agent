import { describe, expect, it } from 'vitest';

import type { EvalTurnResult } from '../src/evals/case-schema';
import { assessGrounding } from '../src/evals/grounding';

function recommendationTurn(args: {
  providerId: number;
  evidenceProviderId?: number;
  category?: string;
  evidenceCategory?: string;
}): EvalTurnResult {
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
      faq_resolution_summary: {
        is_faq_turn: false,
        kb_query_present: false,
        file_search_called: false,
        file_search_output_count: 0,
      },
      close_action_summary: { type: null, category: null, reason_preview: null },
    },
  } as EvalTurnResult;
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
});
