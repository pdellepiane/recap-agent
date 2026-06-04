import crypto from 'node:crypto';

import type { DecisionNode } from '../core/decision-nodes';
import {
  createEmptyPlan,
  mergePlan,
  type PlanSnapshot,
  type ProviderNeed,
} from '../core/plan';
import type { ProviderSummary } from '../core/provider';
import type { ProviderCategory } from '../core/provider-category';
import type { TurnTrace } from '../core/trace';

export type ObservableOperationId =
  | 'add_update_delete_need'
  | 'defer_reactivate_need'
  | 'detail_explain_compare'
  | 'faq_support_boundary'
  | 'select_unselect_replace_provider'
  | 'refine_existing_need';

export type ObservableTurn = {
  operationId: ObservableOperationId | 'start' | 'close';
  text: string;
};

export type ObservableLiveContext = {
  plan: PlanSnapshot | null;
  currentNode: DecisionNode | null;
  trace: TurnTrace | null;
  lastAgentMessage: string | null;
};

type OperationBlock = {
  id: ObservableOperationId;
  turns: ObservableTurn[];
};

type OperationFactory = {
  id: ObservableOperationId;
  build(context: ObservableLiveContext): OperationBlock | null;
};

type ObservableLivePlannerOptions = {
  randomInt?: (exclusiveMax: number) => number;
  maxTurns?: number;
};

const START_TURN: ObservableTurn = {
  operationId: 'start',
  text: 'Quiero planear una boda moderna y elegante en Lima para 120 personas. Necesito catering con sushi y estaciones, fotografia y video natural, musica en vivo elegante, floreria blanca y verde, y local sofisticado de noche. Presupuesto medio-alto.',
};

export class ObservableLiveTurnPlanner {
  private started = false;
  private closing = false;
  private readonly completedOperations = new Set<ObservableOperationId>();
  private pendingTurns: ObservableTurn[] = [];
  private emittedTurnCount = 0;
  private readonly maxTurns: number;
  private readonly randomInt: (exclusiveMax: number) => number;

  constructor(options: ObservableLivePlannerOptions = {}) {
    this.maxTurns = options.maxTurns ?? 28;
    this.randomInt = options.randomInt ?? ((exclusiveMax) => crypto.randomInt(exclusiveMax));
  }

  nextTurn(context: ObservableLiveContext): ObservableTurn | null {
    if (this.emittedTurnCount >= this.maxTurns) {
      return null;
    }

    if (!this.started) {
      this.started = true;
      return this.recordTurn(START_TURN);
    }

    const queuedTurn = this.pendingTurns.shift();
    if (queuedTurn) {
      return this.recordTurn(queuedTurn);
    }

    if (this.closing) {
      return null;
    }

    const eligibleBlocks = this.buildEligibleBlocks(context);
    if (eligibleBlocks.length > 0) {
      const block = this.shuffle(eligibleBlocks)[0];
      if (block) {
        this.completedOperations.add(block.id);
        this.pendingTurns = block.turns.slice(1);
        const firstTurn = block.turns[0];
        return firstTurn ? this.recordTurn(firstTurn) : this.nextTurn(context);
      }
    }

    this.closing = true;
    this.pendingTurns = buildCloseTurns(context).slice(1);
    const firstCloseTurn = buildCloseTurns(context)[0];
    return firstCloseTurn ? this.recordTurn(firstCloseTurn) : null;
  }

  completedOperationIds(): Set<ObservableOperationId> {
    return new Set(this.completedOperations);
  }

  private recordTurn(turn: ObservableTurn): ObservableTurn {
    this.emittedTurnCount += 1;
    return turn;
  }

  private buildEligibleBlocks(context: ObservableLiveContext): OperationBlock[] {
    if (!context.plan) {
      return [];
    }

    return operationFactories
      .filter((factory) => !this.completedOperations.has(factory.id))
      .flatMap((factory) => {
        const block = factory.build(context);
        return block ? [block] : [];
      });
  }

  private shuffle<T>(items: T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = this.randomInt(index + 1);
      const current = shuffled[index];
      const swap = shuffled[swapIndex];
      if (current === undefined || swap === undefined) {
        continue;
      }
      shuffled[index] = swap;
      shuffled[swapIndex] = current;
    }
    return shuffled;
  }
}

export function buildObservableLiveTurns(): ObservableTurn[] {
  const planner = new ObservableLiveTurnPlanner({
    randomInt: (exclusiveMax) => exclusiveMax - 1,
  });
  const context: ObservableLiveContext = {
    plan: null,
    currentNode: null,
    trace: null,
    lastAgentMessage: null,
  };
  const turns: ObservableTurn[] = [];

  for (;;) {
    const turn = planner.nextTurn(context);
    if (!turn) {
      break;
    }
    turns.push(turn);
    if (turn.operationId === 'start') {
      context.plan = buildFixtureObservablePlan();
      context.currentNode = 'elicitacion_necesidades';
    }
  }

  return turns;
}

export function collectObservableOperationIds(turns: ObservableTurn[]): Set<ObservableOperationId> {
  const ids = new Set<ObservableOperationId>();
  for (const turn of turns) {
    if (turn.operationId !== 'start' && turn.operationId !== 'close') {
      ids.add(turn.operationId);
    }
  }
  return ids;
}

const operationFactories: OperationFactory[] = [
  {
    id: 'detail_explain_compare',
    build(context) {
      const need = findNeedWithShortlist(context.plan, 2);
      if (!need) {
        return null;
      }
      const first = need.recommended_providers[0];
      const second = need.recommended_providers[1];
      if (!first || !second) {
        return null;
      }
      return {
        id: 'detail_explain_compare',
        turns: [
          {
            operationId: 'detail_explain_compare',
            text: `Dame mas detalle de ${first.title} para ${need.category} y explicame por que encaja con mi boda.`,
          },
          {
            operationId: 'detail_explain_compare',
            text: `Compara ${first.title} con ${second.title} para ${need.category}, pero solo lo mas importante.`,
          },
        ],
      };
    },
  },
  {
    id: 'select_unselect_replace_provider',
    build(context) {
      const need = findNeedWithShortlist(context.plan, 2);
      if (!need) {
        return null;
      }
      const first = need.recommended_providers[0];
      const second = need.recommended_providers[1];
      if (!first || !second) {
        return null;
      }
      return {
        id: 'select_unselect_replace_provider',
        turns: [
          {
            operationId: 'select_unselect_replace_provider',
            text: `Selecciona ${first.title} para ${need.category}.`,
          },
          {
            operationId: 'select_unselect_replace_provider',
            text: `Quita esa seleccion de ${need.category}; quiero compararla un poco mas.`,
          },
          {
            operationId: 'select_unselect_replace_provider',
            text: `Busca proveedores de ${need.category} en Lima con estilo natural; quiero ver varias opciones nuevas para comparar.`,
          },
          {
            operationId: 'select_unselect_replace_provider',
            text: `Selecciona la primera opcion de ${need.category} de esa lista.`,
          },
          {
            operationId: 'select_unselect_replace_provider',
            text: `Reemplaza esa seleccion por ${second.title} para ${need.category}.`,
          },
          ...buildSecondarySelectionTurns(context.plan, need.category),
        ],
      };
    },
  },
  {
    id: 'add_update_delete_need',
    build() {
      return {
        id: 'add_update_delete_need',
        turns: [
          {
            operationId: 'add_update_delete_need',
            text: 'Agrega una necesidad de licores para barra de cocteles elegante.',
          },
          {
            operationId: 'add_update_delete_need',
            text: 'Actualiza licores: prefiero cocteles de autor y una barra sobria, nada muy informal.',
          },
          {
            operationId: 'add_update_delete_need',
            text: 'Borra por completo la necesidad de licores del plan; no la dejes pausada.',
          },
        ],
      };
    },
  },
  {
    id: 'defer_reactivate_need',
    build(context) {
      const need = findNeedForDeferral(context.plan);
      if (!need) {
        return null;
      }
      return {
        id: 'defer_reactivate_need',
        turns: [
          {
            operationId: 'defer_reactivate_need',
            text: `Para ${need.category} no quiero ninguna opcion por ahora, dejala sin proveedor.`,
          },
          {
            operationId: 'defer_reactivate_need',
            text: `Reactiva ${need.category}; si quiero mantenerla en el plan para revisar opciones despues.`,
          },
        ],
      };
    },
  },
  {
    id: 'faq_support_boundary',
    build() {
      return {
        id: 'faq_support_boundary',
        turns: [
          {
            operationId: 'faq_support_boundary',
            text: 'Pregunta aparte: si tengo un problema con un regalo de mi web o con una marca, que deberia hacer?',
          },
          {
            operationId: 'faq_support_boundary',
            text: 'Y si necesito ayuda humana por un error, por donde puedo contactar a soporte?',
          },
        ],
      };
    },
  },
  {
    id: 'refine_existing_need',
    build(context) {
      const need = findNeedForRefinement(context.plan);
      if (!need) {
        return null;
      }
      return {
        id: 'refine_existing_need',
        turns: [
          {
            operationId: 'refine_existing_need',
            text: `Refina ${need.category}: quiero que sea de noche, sofisticado, en Lima o cerca, y que funcione para 120 personas.`,
          },
        ],
      };
    },
  },
];

function buildCloseTurns(context: ObservableLiveContext): ObservableTurn[] {
  const pendingInstructions = summarizePendingCloseInstructions(context.plan);
  return [
    {
      operationId: 'close',
      text: pendingInstructions,
    },
    {
      operationId: 'close',
      text: 'Quiero cerrar el plan y contactar a los proveedores seleccionados.',
    },
    {
      operationId: 'close',
      text: 'Soy Valentina Ramos, mi correo es valentina.eval@example.com y mi telefono es +51 954779071.',
    },
  ];
}

function summarizePendingCloseInstructions(plan: PlanSnapshot | null): string {
  if (!plan) {
    return 'Para cerrar, selecciona la primera opcion disponible para cada frente que siga pendiente y deja sin proveedor cualquier frente que no tenga una opcion clara.';
  }

  const pendingSelections = plan.provider_needs
    .filter((need) => need.selected_provider_ids.length === 0 && need.recommended_providers.length > 0)
    .map((need) => {
      const firstProvider = need.recommended_providers[0];
      return firstProvider ? `${firstProvider.title} para ${need.category}` : null;
    })
    .filter((entry): entry is string => Boolean(entry));
  const needsWithoutOptions = plan.provider_needs
    .filter((need) => need.selected_provider_ids.length === 0 && need.recommended_providers.length === 0)
    .map((need) => need.category);

  if (pendingSelections.length === 0 && needsWithoutOptions.length === 0) {
    return 'Para cerrar, revisa el plan actual y deja listas las selecciones que ya tenemos.';
  }

  return [
    pendingSelections.length > 0
      ? `Para cerrar, selecciona ${pendingSelections.join(', ')}.`
      : null,
    needsWithoutOptions.length > 0
      ? `Deja sin proveedor por ahora: ${needsWithoutOptions.join(', ')}.`
      : null,
  ].filter(Boolean).join(' ');
}

function buildSecondarySelectionTurns(
  plan: PlanSnapshot | null,
  primaryCategory: ProviderCategory,
): ObservableTurn[] {
  const secondaryNeed = plan?.provider_needs.find(
    (need) =>
      need.category !== primaryCategory &&
      need.selected_provider_ids.length === 0 &&
      need.recommended_providers.length > 0,
  );
  const secondaryProvider = secondaryNeed?.recommended_providers[0];
  if (!secondaryNeed || !secondaryProvider) {
    return [];
  }

  return [
    {
      operationId: 'select_unselect_replace_provider',
      text: `Selecciona ${secondaryProvider.title} para ${secondaryNeed.category}.`,
    },
  ];
}

function findNeedWithShortlist(
  plan: PlanSnapshot | null,
  minimumProviders: number,
): ProviderNeed | null {
  return plan?.provider_needs.find(
    (need) => need.recommended_providers.length >= minimumProviders,
  ) ?? null;
}

function findNeedForDeferral(plan: PlanSnapshot | null): ProviderNeed | null {
  return plan?.provider_needs.find(
    (need) => need.selected_provider_ids.length === 0,
  ) ?? null;
}

function findNeedForRefinement(plan: PlanSnapshot | null): ProviderNeed | null {
  return (
    plan?.provider_needs.find((need) => need.category === 'Locales') ??
    plan?.provider_needs[0] ??
    null
  );
}

function buildFixtureObservablePlan(): PlanSnapshot {
  const base = createEmptyPlan({
    planId: 'observable-fixture-plan',
    channel: 'terminal_whatsapp_eval',
    externalUserId: 'observable-fixture-user',
  });

  return mergePlan(base, {
    current_node: 'elicitacion_necesidades',
    intent: 'elicitar_necesidades',
    event_type: 'boda',
    location: 'Lima',
    budget_signal: 'medio-alto',
    guest_range: '101-200',
    active_need_category: 'Fotografía y video',
    provider_needs: [
      fixtureNeed('Fotografía y video', [
        fixtureProvider(101, 'Foto Natural Studio', 'Fotografía y video'),
        fixtureProvider(102, 'Luz Clara Films', 'Fotografía y video'),
      ]),
      fixtureNeed('Catering', [
        fixtureProvider(201, 'EDO Sushi Bar', 'Catering'),
        fixtureProvider(202, 'Mesa Nikkei', 'Catering'),
      ]),
      fixtureNeed('Música', []),
      fixtureNeed('Locales', [
        fixtureProvider(301, 'Casa Lima Noche', 'Locales'),
        fixtureProvider(302, 'Jardin Urbano', 'Locales'),
      ]),
    ],
  });
}

function fixtureNeed(
  category: ProviderCategory,
  providers: ProviderSummary[],
): ProviderNeed {
  return {
    category,
    status: providers.length > 0 ? 'shortlisted' : 'identified',
    preferences: [],
    hard_constraints: [],
    missing_fields: [],
    recommended_provider_ids: providers.map((provider) => provider.id),
    recommended_providers: providers,
    sub_query_results: [],
    selected_provider_ids: [],
    selected_provider_hints: [],
  };
}

function fixtureProvider(
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
