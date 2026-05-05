import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { SinEnvolturasGateway } from '../src/runtime/sinenvolturas-gateway';
import type { ProviderVectorSearchResult } from '../src/runtime/provider-vector-search';

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
      category: 'Catering',
      location: 'Lima',
      page: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/vendor/filtered?search=Catering+Lima&page=1',
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
        active_need_category: 'Música',
        vendor_category: 'Música',
        location: 'Lima',
        conversation_summary: 'Matrimonio en Lima, música primero.',
      },
    );

    const result = await gateway.searchProviders(plan);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.location).toBe('Perú');
  });

  it('hybrid search deduplicates API and vector candidates while preserving enriched metadata', async () => {
    const responses = new Map<string, unknown>([
      [
        'https://api.example.test/vendor/filtered?search=Fotograf%C3%ADa%20y%20video&page=1',
        {
          status: true,
          errors: null,
          error: '',
          data: {
            data: [
              {
                id: 1,
                slug: 'foto-api',
                translations: [{ title: 'Foto API' }],
                category: { translations: [{ name: 'Fotografía' }] },
                city: { name: 'Lima' },
                country: { name: 'Perú' },
              },
            ],
          },
        },
      ],
      [
        'https://api.example.test/vendor/relevant',
        {
          status: true,
          errors: null,
          error: '',
          data: [],
        },
      ],
      [
        'https://api.example.test/vendor/2',
        {
          status: true,
          errors: null,
          error: '',
          data: {
            id: 2,
            slug: 'foto-vector',
            translations: [{ title: 'Foto Vector' }],
            category: { translations: [{ name: 'Fotografía' }] },
            city: { name: 'Lima' },
            country: { name: 'Perú' },
            info_translations: [
              {
                title: 'Acerca del proveedor',
                description: 'Fotografía documental natural para bodas íntimas.',
                language: { locale: 'es' },
              },
            ],
          },
        },
      ],
    ]);
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const body = responses.get(url);
      if (!body) {
        return Promise.resolve({
          ok: true,
          async json() {
            return {
              status: true,
              errors: null,
              error: '',
              data: { data: [] },
            };
          },
        });
      }
      return Promise.resolve({
        ok: true,
        async json() {
          return body;
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const vectorSearch = {
      async search(): Promise<ProviderVectorSearchResult[]> {
        return [
          {
            providerId: 2,
            score: 0.91,
            matchedText: 'Fotografía documental natural para bodas íntimas.',
            attributes: { provider_id: 2 },
            filename: '2-foto-vector.md',
          },
        ];
      },
    };
    const gateway = new SinEnvolturasGateway({
      baseUrl: 'https://api.example.test/vendor',
      persistedSearchLimit: 5,
      summarySearchWordLimit: 10,
      searchMode: 'hybrid',
      vectorSearchGateway: vectorSearch,
    });
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'plan-hybrid',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-1',
      }),
      {
        event_type: 'boda',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        location: 'Lima',
        conversation_summary: 'Busco foto documental natural.',
      },
    );

    const result = await gateway.searchProviders(plan);

    expect(result.providers.map((provider) => provider.id)).toEqual([2, 1]);
    expect(result.providers[0]?.retrievalSource).toBe('vector');
    expect(result.providers[0]?.descriptionSnippet).toContain('Fotografía documental');
  });
});
