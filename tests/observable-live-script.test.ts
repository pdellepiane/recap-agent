import { describe, expect, it } from 'vitest';

import {
  buildObservableLiveTurns,
  collectObservableOperationIds,
  type ObservableOperationId,
} from '../src/evals/observable-live-script';

describe('observable live eval script', () => {
  it('starts from scratch, ends with close turns, and covers every supported operation group', () => {
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
    expect(turns.at(-1)?.operationId).toBe('close');
    expect(turns.some((turn) => turn.text.toLowerCase().includes('seed'))).toBe(false);
    for (const operationId of requiredOperations) {
      expect(operationIds.has(operationId)).toBe(true);
    }
  });

  it('keeps operation blocks internally ordered while allowing shuffled block order', () => {
    const turns = buildObservableLiveTurns();
    const addIndex = turns.findIndex((turn) => turn.text.startsWith('Agrega una necesidad'));
    const updateIndex = turns.findIndex((turn) => turn.text.startsWith('Actualiza licores'));
    const deleteIndex = turns.findIndex((turn) => turn.text.startsWith('Borra por completo la necesidad de licores'));
    const selectIndex = turns.findIndex((turn) => turn.text.startsWith('Selecciona la primera opcion de fotografia'));
    const unselectIndex = turns.findIndex((turn) => turn.text.startsWith('Quita esa seleccion'));
    const morePhotographyIndex = turns.findIndex((turn) => turn.text.startsWith('Busca proveedores de fotografia'));
    const selectFromListIndex = turns.findIndex((turn) => turn.text.startsWith('Selecciona la primera opcion de fotografia y video de esa lista'));
    const replaceIndex = turns.findIndex((turn) => turn.text.startsWith('Reemplaza esa seleccion'));
    const cateringSelectIndex = turns.findIndex((turn) => turn.text.startsWith('Selecciona Edo Sushi Bar'));

    expect(addIndex).toBeGreaterThan(0);
    expect(updateIndex).toBeGreaterThan(addIndex);
    expect(deleteIndex).toBeGreaterThan(updateIndex);
    expect(selectIndex).toBeGreaterThan(0);
    expect(unselectIndex).toBeGreaterThan(selectIndex);
    expect(morePhotographyIndex).toBeGreaterThan(unselectIndex);
    expect(selectFromListIndex).toBeGreaterThan(morePhotographyIndex);
    expect(replaceIndex).toBeGreaterThan(selectFromListIndex);
    expect(cateringSelectIndex).toBeGreaterThan(replaceIndex);
  });
});
