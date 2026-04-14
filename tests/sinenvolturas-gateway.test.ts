import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { SinEnvolturasGateway } from '../src/runtime/sinenvolturas-gateway';

describe('SinEnvolturasGateway strict search mapping', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps keyword searches to the allowlisted filtered params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          status: true,
          errors: null,
          error: '',
          data: {
            data: [
              {
                id: 21,
                slug: 'foto-uno',
                translations: [{ title: 'Foto Uno' }],
              },
            ],
          },
        };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new SinEnvolturasGateway({
      baseUrl: 'https://api.example.test/vendor',
      persistedSearchLimit: 5,
      summarySearchWordLimit: 10,
    });

    const result = await gateway.searchProvidersByKeyword({
      keyword: 'fotografia documental',
      page: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/vendor/filtered?search=fotografia+documental&page=2',
    );
    expect(result.providers[0]?.id).toBe(21);
  });

  it('maps category-location searches to the allowlisted filtered params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          status: true,
          errors: null,
          error: '',
          data: {
            data: [
              {
                id: 35,
                slug: 'edo-sushi-bar',
                translations: [{ title: 'EDO Sushi Bar' }],
              },
            ],
          },
        };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new SinEnvolturasGateway({
      baseUrl: 'https://api.example.test/vendor',
      persistedSearchLimit: 5,
      summarySearchWordLimit: 10,
    });

    const result = await gateway.searchProvidersByCategoryLocation({
      category: 'catering',
      location: 'Lima',
      page: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/vendor/filtered?search=catering+Lima&page=1',
    );
    expect(result.providers[0]?.id).toBe(35);
  });

  it('keeps category matches when provider location granularity is broader than the plan city', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          status: true,
          errors: null,
          error: '',
          data: {
            data: [
              {
                id: 115,
                slug: 'dj-naoki',
                rating: '0.0',
                price_level: null,
                min_price: null,
                max_price: null,
                translations: [{ title: 'Dj Naoki' }],
                category: {
                  translations: [{ name: 'Música' }],
                },
                city: null,
                country: { name: 'Perú' },
              },
            ],
          },
        };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new SinEnvolturasGateway({
      baseUrl: 'https://api.example.test/vendor',
      persistedSearchLimit: 5,
      summarySearchWordLimit: 10,
    });
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'plan-music-location',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-1',
      }),
      {
        event_type: 'matrimonio',
        active_need_category: 'música',
        vendor_category: 'música',
        location: 'Lima',
        conversation_summary: 'Matrimonio en Lima, música primero.',
      },
    );

    const result = await gateway.searchProviders(plan);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.location).toBe('Perú');
  });
});
