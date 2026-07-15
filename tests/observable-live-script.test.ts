import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan, type PlanSnapshot, type ProviderNeed } from '../src/core/plan';
import type { ProviderSummary } from '../src/core/provider';
import type { ProviderCategory } from '../src/core/provider-category';
import {
  buildLambdaRequestBody,
  parseLambdaPayload,
} from '../src/evals/live-observable-cli';
import {
  buildObservableLiveTurns,
  collectObservableOperationIds,
  ObservableLiveTurnPlanner,
  type ObservableLiveContext,
  type ObservableOperationId,
  type ObservableTurn,
} from '../src/evals/observable-live-script';

describe('observable live eval script', () => {
  it('starts from scratch, closes last, and covers every supported operation group', () => {
    const turns = buildObservableLiveTurns();
    const operationIds = collectObservableOperationIds(turns);
    const requiredOperations: ObservableOperationId[] = [
      'add_update_delete_need',
      'defer_reactivate_need',
      'detail_explain_compare',
      'faq_support_boundary',
      'select_unselect_replace_provider',
      'refine_existing_need',
    ];

    expect(turns[0]?.operationId).toBe('start');
    expect(tailOperationIds(turns)).toEqual(['close', 'close', 'close']);
    expect(turns.some((turn) => turn.text.toLowerCase().includes('seed'))).toBe(false);
    for (const operationId of requiredOperations) {
      expect(operationIds.has(operationId)).toBe(true);
    }
  });

  it('shuffles eligible operation blocks while keeping dependent sub-turns ordered', () => {
    const firstSequence = collectPlannerTurns(new ObservableLiveTurnPlanner({
      randomInt: () => 0,
    }), richContext());
    const secondSequence = collectPlannerTurns(new ObservableLiveTurnPlanner({
      randomInt: (exclusiveMax) => exclusiveMax - 1,
    }), richContext());

    expect(operationSequence(firstSequence)).not.toEqual(operationSequence(secondSequence));

    const selectionTexts = firstSequence
      .filter((turn) => turn.operationId === 'select_unselect_replace_provider')
      .map((turn) => turn.text);
    expect(selectionTexts.findIndex((text) => text.startsWith('Selecciona '))).toBeGreaterThanOrEqual(0);
    expect(selectionTexts.findIndex((text) => text.startsWith('Quita esa seleccion'))).toBeGreaterThan(
      selectionTexts.findIndex((text) => text.startsWith('Selecciona ')),
    );
    expect(selectionTexts.findIndex((text) => text.startsWith('Busca proveedores'))).toBeGreaterThan(
      selectionTexts.findIndex((text) => text.startsWith('Quita esa seleccion')),
    );
    expect(selectionTexts.findIndex((text) => text.startsWith('Reemplaza esa seleccion'))).toBeGreaterThan(
      selectionTexts.findIndex((text) => text.startsWith('Busca proveedores')),
    );
  });

  it('uses actual plan providers and needs in detail, comparison, selection, and close turns', () => {
    const turns = collectPlannerTurns(new ObservableLiveTurnPlanner({
      randomInt: (exclusiveMax) => exclusiveMax - 1,
    }), richContext());
    const text = turns.map((turn) => turn.text).join('\n');

    expect(text).toContain('Foto Uno');
    expect(text).toContain('Foto Dos');
    expect(text).toContain('Fotografía y video');
    expect(text).toContain('Local Noche');
    expect(text).toContain('Locales');
  });

  it('does not invent provider names when the current plan has no shortlists', () => {
    const context = contextWithPlan(planWithNeeds([
      need('Música', []),
      need('Locales', []),
    ]));
    const turns = collectPlannerTurns(new ObservableLiveTurnPlanner({
      randomInt: (exclusiveMax) => exclusiveMax - 1,
      maxTurns: 16,
    }), context);
    const text = turns.map((turn) => turn.text).join('\n');

    expect(collectObservableOperationIds(turns).has('detail_explain_compare')).toBe(false);
    expect(collectObservableOperationIds(turns).has('select_unselect_replace_provider')).toBe(false);
    expect(text).not.toContain('Foto Uno');
    expect(text).not.toContain('EDO Sushi Bar');
    expect(text).not.toContain('Local Noche');
  });

  it('builds CLI Lambda requests in diagnostic mode and parses hidden plan diagnostics', () => {
    const body = buildLambdaRequestBody({
      channel: 'terminal_whatsapp_eval',
      userId: 'observable-user',
      text: 'hola',
      messageId: 'observable-0',
      receivedAt: '2026-05-26T00:00:00.000Z',
      sessionId: 'observable-session',
    });

    expect(body).not.toHaveProperty('operation');
    expect(body.client_mode).toBe('cli');

    const plan = richPlan();
    const parsed = parseLambdaPayload({
      message: 'Tengo opciones.',
      current_node: 'recomendar',
      plan,
      trace: {
        trace_id: 'trace-observable',
      },
    });

    expect(parsed.message).toBe('Tengo opciones.');
    expect(parsed.currentNode).toBe('recomendar');
    expect(parsed.plan?.plan_id).toBe(plan.plan_id);
    expect(parsed.trace).toEqual({ trace_id: 'trace-observable' });
  });
});

function collectPlannerTurns(
  planner: ObservableLiveTurnPlanner,
  context: ObservableLiveContext,
): ObservableTurn[] {
  const turns: ObservableTurn[] = [];
  for (;;) {
    const turn = planner.nextTurn(context);
    if (!turn) {
      break;
    }
    turns.push(turn);
    if (turn.operationId === 'start' && !context.plan) {
      context.plan = richPlan();
      context.currentNode = 'elicitacion_necesidades';
    }
  }
  return turns;
}

function operationSequence(turns: ObservableTurn[]): Array<ObservableTurn['operationId']> {
  return turns.map((turn) => turn.operationId);
}

function tailOperationIds(turns: ObservableTurn[]): Array<ObservableTurn['operationId']> {
  return turns.slice(-3).map((turn) => turn.operationId);
}

function richContext(): ObservableLiveContext {
  return contextWithPlan(richPlan());
}

function contextWithPlan(plan: PlanSnapshot): ObservableLiveContext {
  return {
    plan,
    currentNode: plan.current_node,
    trace: null,
    lastAgentMessage: null,
  };
}

function richPlan(): PlanSnapshot {
  return planWithNeeds([
    need('Fotografía y video', [
      provider(101, 'Foto Uno', 'Fotografía y video'),
      provider(102, 'Foto Dos', 'Fotografía y video'),
    ]),
    need('Catering', [
      provider(201, 'EDO Sushi Bar', 'Catering'),
      provider(202, 'Mesa Nikkei', 'Catering'),
    ]),
    need('Música', []),
    need('Locales', [
      provider(301, 'Local Noche', 'Locales'),
      provider(302, 'Casa Jardin', 'Locales'),
    ]),
  ]);
}

function planWithNeeds(providerNeeds: ProviderNeed[]): PlanSnapshot {
  return mergePlan(
    createEmptyPlan({
      planId: 'plan-observable-test',
      channel: 'terminal_whatsapp_eval',
      externalUserId: 'observable-user',
    }),
    {
      current_node: 'elicitacion_necesidades',
      intent: 'elicitar_necesidades',
      event_type: 'boda',
      location: 'Lima',
      guest_range: '101-200',
      active_need_category: providerNeeds[0]?.category ?? null,
      provider_needs: providerNeeds,
    },
  );
}

function need(category: ProviderCategory, providers: ProviderSummary[]): ProviderNeed {
  return {
    category,
    status: providers.length > 0 ? 'shortlisted' : 'identified',
    preferences: [],
    hard_constraints: [],
    missing_fields: [],
    recommended_provider_ids: providers.map((item) => item.id),
    recommended_providers: providers,
    sub_query_results: [],
    selected_provider_ids: [],
    selected_provider_hints: [],
  };
}

function provider(
  id: number,
  title: string,
  category: ProviderCategory,
): ProviderSummary {
  return {
    id,
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category,
    location: 'Lima',
    priceLevel: 'mid',
    rating: '4.8',
    reason: 'coincide con el plan',
    detailUrl: `https://sinenvolturas.com/proveedores/${id}`,
    websiteUrl: null,
    minPrice: null,
    maxPrice: null,
    promoBadge: null,
    promoSummary: null,
    descriptionSnippet: null,
    serviceHighlights: [],
    termsHighlights: [],
  };
}
