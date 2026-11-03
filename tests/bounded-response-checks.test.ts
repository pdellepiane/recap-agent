import { describe, expect, it } from 'vitest';
import { expectationSchema } from '../src/evals/case-schema';
import { checkDisplayedSelection, checkFirstSelection, inspectProviderCards } from '../src/evals/bounded-response-checks';
const p = { id: 7, detailUrl: 'https://sinenvolturas.com/proveedores/seven', location: 'Lima, Perú', priceLevel: 'mid', minPrice: '6000.00' };
describe('bounded response checks', () => {
  it('requires the option to be displayed before it is selected', () => {
    expect(expectationSchema.safeParse({type:'provider_displayed_selection',sourceTurnIndex:1,turnIndex:0,ordinal:2}).success).toBe(false);
    expect(expectationSchema.safeParse({type:'provider_displayed_selection',sourceTurnIndex:0,turnIndex:1,ordinal:2}).success).toBe(true);
  });
  it('compares fields actually rendered in a uniquely linked card to retained trace evidence', () => {
    const cards = inspectProviderCards('1. Seven\n Ubicación: Lima, Perú.\n Precio: $$.\n Ficha: https://sinenvolturas.com/proveedores/seven', [p]);
    expect(cards).toMatchObject([{providerId:7,linkEvidence:'matched',location:'matched',priceLevel:'matched'}]);
    expect(checkFirstSelection(cards, [7])).toBe('matched');
    expect(checkFirstSelection(cards, [8])).toBe('different');
  });
  it('detects different explicit values without claiming semantic falsity', () => {
    const cards = inspectProviderCards('1. Seven (Arequipa · $$$ · promo: vigente)\n Ficha: https://sinenvolturas.com/proveedores/seven', [p]);
    expect(cards[0]).toMatchObject({location:'different',priceLevel:'different'});
  });
  it('binds second-choice selection to the second unique displayed provider', () => {
    const other = { id: 8, detailUrl: 'https://sinenvolturas.com/proveedores/eight', location: 'Lima', priceLevel: 'high' };
    const cards = inspectProviderCards('1. Seven\n Ficha: https://sinenvolturas.com/proveedores/seven\n2. Eight\n Ficha: https://sinenvolturas.com/proveedores/eight', [p,other]);
    expect(checkDisplayedSelection(cards,[8],2)).toBe('matched');
    expect(checkDisplayedSelection(cards,[7],2)).toBe('different');
    expect(checkDisplayedSelection(cards,[],2)).toBe('not_selected');
  });
  it('checks only explicitly phrased minimum-price numbers, with unknown currency', () => {
    const make = (prose: string) => inspectProviderCards(`1. Seven\n ${prose}\n Ficha: https://sinenvolturas.com/proveedores/seven`, [p])[0].minimumPrice;
    expect(make('Tiene un precio mínimo publicado de S/ 6,000.')).toBe('matched');
    expect(make('Tiene un precio mínimo de S/ 5,000.')).toBe('different');
    expect(make('No tiene precio mínimo publicado de S/ 6,000.')).toBe('not_detected');
    expect(make('Promoción S/ 6,000.')).toBe('not_detected');
    expect(inspectProviderCards('1. Seven\n precio mínimo de S/ 6,000.\n Ficha: https://sinenvolturas.com/proveedores/seven', [{...p,minPrice:null}])[0].minimumPrice).toBe('unassessable');
  });
  it('does not invent evidence when links, fields, providers, or selection are ambiguous', () => {
    const text = '1. Seven\n Precio: $$.\n Ficha: https://sinenvolturas.com/proveedores/seven';
    expect(inspectProviderCards(text, [p,p])[0]).toMatchObject({providerId:null,linkEvidence:'unassessable',priceLevel:'unassessable',location:'not_detected'});
    expect(inspectProviderCards('1. Seven\n Precio: $$', [p])[0].priceLevel).toBe('unassessable');
    const cards = inspectProviderCards(text+'\n1. Other\n Ficha: https://sinenvolturas.com/proveedores/other',[p]);
    expect(checkFirstSelection(cards,[7])).toBe('unassessable');
    expect(checkFirstSelection(inspectProviderCards(text,[p]),[])).toBe('not_selected');
  });
});
