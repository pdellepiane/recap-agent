import { describe, expect, it } from 'vitest';
import { deliveredProviderOptions, resolveDeliveredProviderId } from '../src/runtime/delivered-provider-options';

describe('delivered provider option evidence', () => {
  const providers = [
    { id: 189, detailUrl: 'https://sinenvolturas.com/proveedores/cafe' },
    { id: 136, detailUrl: 'https://sinenvolturas.com/proveedores/foodies' },
  ];
  it('uses message order instead of candidate order', () => {
    expect(deliveredProviderOptions('1. Foodies\nhttps://sinenvolturas.com/proveedores/foodies\n2. Cafe\nhttps://sinenvolturas.com/proveedores/cafe', providers)).toEqual([
      { ordinal: 1, providerId: 136 }, { ordinal: 2, providerId: 189 },
    ]);
  });
  it('rejects missing, duplicate, and ambiguous link evidence', () => {
    expect(deliveredProviderOptions('1. Foodies', providers)).toBeNull();
    expect(deliveredProviderOptions('1. A\nhttps://sinenvolturas.com/proveedores/cafe\n1. B\nhttps://sinenvolturas.com/proveedores/foodies', providers)).toBeNull();
    expect(deliveredProviderOptions('1. A\nhttps://sinenvolturas.com/proveedores/cafe', [...providers, { id: 3, detailUrl: providers[0].detailUrl }])).toBeNull();
  });
  it('uses the latest confirmed outbound order and rejects an unsent list', () => {
    const body = '1. Foodies\nhttps://sinenvolturas.com/proveedores/foodies\n2. Cafe\nhttps://sinenvolturas.com/proveedores/cafe';
    expect(resolveDeliveredProviderId([{ direction: 'outbound', status: 'sent', body }], providers, 2)).toBe(189);
    expect(resolveDeliveredProviderId([{ direction: 'outbound', status: 'failed', body }], providers, 2)).toBeNull();
    expect(resolveDeliveredProviderId([{ direction: 'outbound', status: 'sent', body }, { direction: 'outbound', status: 'sent', body: 'No list' }], providers, 2)).toBeNull();
  });
});
