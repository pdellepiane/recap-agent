import crypto from 'node:crypto';

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

type OperationBlock = {
  id: ObservableOperationId;
  turns: ObservableTurn[];
};

export function buildObservableLiveTurns(): ObservableTurn[] {
  const operationBlocks = shuffleOperationBlocks([
    {
      id: 'detail_explain_compare',
      turns: [
        {
          operationId: 'detail_explain_compare',
          text: 'Dame mas detalle de la primera opcion de fotografia y video y explicame por que encaja con mi boda.',
        },
        {
          operationId: 'detail_explain_compare',
          text: 'Compara esa opcion con la segunda de fotografia y video, pero solo lo mas importante.',
        },
      ],
    },
    {
      id: 'select_unselect_replace_provider',
      turns: [
        {
          operationId: 'select_unselect_replace_provider',
          text: 'Selecciona la primera opcion de fotografia y video.',
        },
        {
          operationId: 'select_unselect_replace_provider',
          text: 'Quita esa seleccion de fotografia y video; quiero compararla un poco mas.',
        },
        {
          operationId: 'select_unselect_replace_provider',
          text: 'Busca proveedores de fotografia y video en Lima con estilo natural; quiero ver varias opciones nuevas para comparar.',
        },
        {
          operationId: 'select_unselect_replace_provider',
          text: 'Selecciona la primera opcion de fotografia y video de esa lista.',
        },
        {
          operationId: 'select_unselect_replace_provider',
          text: 'Reemplaza esa seleccion por la segunda opcion de fotografia y video que acabas de mostrar.',
        },
        {
          operationId: 'select_unselect_replace_provider',
          text: 'Selecciona Edo Sushi Bar para Catering.',
        },
      ],
    },
    {
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
    },
    {
      id: 'defer_reactivate_need',
      turns: [
        {
          operationId: 'defer_reactivate_need',
          text: 'Para musica no quiero ninguna opcion por ahora, dejala sin proveedor.',
        },
        {
          operationId: 'defer_reactivate_need',
          text: 'Reactiva musica; si quiero mantenerla en el plan para revisar opciones despues.',
        },
      ],
    },
    {
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
    },
    {
      id: 'refine_existing_need',
      turns: [
        {
          operationId: 'refine_existing_need',
          text: 'Refina locales: quiero que sea de noche, sofisticado, en Lima o cerca, y que funcione para 120 personas.',
        },
      ],
    },
  ]);

  return [
    {
      operationId: 'start',
      text: 'Quiero planear una boda moderna y elegante en Lima para 120 personas. Necesito catering con sushi y estaciones, fotografia y video natural, musica en vivo elegante, floreria blanca y verde, y local sofisticado de noche. Presupuesto medio-alto.',
    },
    ...operationBlocks.flatMap((block) => block.turns),
    {
      operationId: 'close',
      text: 'Para cerrar, selecciona la primera opcion disponible para cada frente que siga pendiente y deja sin proveedor cualquier frente que no tenga una opcion clara.',
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

export function collectObservableOperationIds(turns: ObservableTurn[]): Set<ObservableOperationId> {
  const ids = new Set<ObservableOperationId>();
  for (const turn of turns) {
    if (turn.operationId !== 'start' && turn.operationId !== 'close') {
      ids.add(turn.operationId);
    }
  }
  return ids;
}

function shuffleOperationBlocks(blocks: OperationBlock[]): OperationBlock[] {
  const shuffled = [...blocks];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    const current = shuffled[index];
    const swap = shuffled[swapIndex];
    if (!current || !swap) {
      continue;
    }
    shuffled[index] = swap;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}
