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

  it('looks up user event context by email through the guest service endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          status: true,
          errors: null,
          error: null,
          data: {
            user: { id: 42, email: 'maria.garcia@gmail.com' },
            events: [],
            recent_orders: [],
            guest_in_events: [
              {
                id: 312,
                will_attend: true,
                event: {
                  id: 205,
                  slug: 'cumple-ana-2026',
                  name: 'Cumpleaños de Ana',
                  datetime: '2026-06-15T19:00:00Z',
                  country: { name: 'Perú' },
                },
              },
            ],
            host_in_events: [],
            celebrated_in: [],
            subscriptions: [],
            summary: { guest_in_events_count: 1 },
          },
        };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new SinEnvolturasGateway({
      baseUrl: 'https://api.example.test/vendor',
      guestServiceBaseUrl: 'https://api.example.test/guest-service',
      persistedSearchLimit: 5,
      summarySearchWordLimit: 10,
    });

    const result = await gateway.lookupUserEventContext({
      email: 'maria.garcia@gmail.com',
      phone: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/guest-service/user-lookup?email=maria.garcia%40gmail.com',
    );
    expect(result?.user?.email).toBe('maria.garcia@gmail.com');
    expect(result?.events).toHaveLength(1);
    const event = result?.events[0];
    expect(event?.relation).toBe('guest');
    expect(event?.eventId).toBe(205);
    expect(event?.name).toBe('Cumpleaños de Ana');
    expect(event?.url).toBe('https://sinenvolturas.com/cumple-ana-2026');
    expect(event?.place).toBe('Perú');
    expect(event?.datetime).toBe('2026-06-15T19:00:00Z');
    expect(event?.guestStatus?.willAttend).toBe(true);
    expect(result?.counts.guestEvents).toBe(1);
    expect(result).not.toHaveProperty('raw');
    expect(result).not.toHaveProperty('guest_in_events');
  });

  it('looks up user event context by phone through the guest service endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          status: true,
          errors: null,
          error: null,
          data: {
            user: { id: 42, phone_number: '987654321', full_phone: '+51 987654321' },
            events: [],
            recent_orders: [],
            guest_in_events: [],
            host_in_events: [],
            celebrated_in: [],
            subscriptions: [],
            summary: {},
          },
        };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new SinEnvolturasGateway({
      baseUrl: 'https://api.example.test/vendor',
      guestServiceBaseUrl: 'https://api.example.test/guest-service',
      persistedSearchLimit: 5,
      summarySearchWordLimit: 10,
    });

    const result = await gateway.lookupUserEventContext({
      email: null,
      phone: '987654321',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/guest-service/user-lookup?phone=987654321',
    );
    expect(result?.lookup).toEqual({ email: null, phone: '987654321' });
    expect(result?.user?.fullPhone).toBe('+51 987654321');
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
        event_type: 'boda',
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
      async searchQueryIntent(): Promise<ProviderVectorSearchResult[]> {
        return [];
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

    expect(result.providers.map((provider) => provider.id)).toEqual([1, 2]);
    expect(result.providers[0]?.retrievalSource).toBe('api');
    expect(result.providers[1]?.retrievalSource).toBe('vector');
    expect(result.providers[1]?.descriptionSnippet).toContain('Fotografía documental');
  });

  it('filters cross-country hybrid vector results when Peru providers are available', async () => {
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
                id: 132,
                slug: 'carlos-romero-films',
                translations: [{ title: 'Carlos Romero Films' }],
                category: { translations: [{ name: 'Fotografía y video' }] },
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
        'https://api.example.test/vendor/142',
        {
          status: true,
          errors: null,
          error: '',
          data: {
            id: 142,
            slug: 'agalux-studio',
            translations: [{ title: 'Agalux Studio' }],
            category: { translations: [{ name: 'Fotografía y video' }] },
            city: { name: 'Lima' },
            country: { name: 'Perú' },
          },
        },
      ],
      [
        'https://api.example.test/vendor/164',
        {
          status: true,
          errors: null,
          error: '',
          data: {
            id: 164,
            slug: 'on-weddings',
            translations: [{ title: 'On Weddings' }],
            category: { translations: [{ name: 'Fotografía y video' }] },
            city: { name: 'León' },
            country: { name: 'México' },
          },
        },
      ],
      [
        'https://api.example.test/vendor/173',
        {
          status: true,
          errors: null,
          error: '',
          data: {
            id: 173,
            slug: 'llum-studio',
            translations: [{ title: 'LLUM Studio' }],
            category: { translations: [{ name: 'Fotografía y video' }] },
            city: { name: 'Santiago de Querétaro' },
            country: { name: 'México' },
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
            providerId: 164,
            score: 0.98,
            matchedText: 'Fotografía para bodas destino.',
            attributes: { provider_id: 164, country_key: 'mexico' },
            filename: '164-on-weddings.md',
          },
          {
            providerId: 173,
            score: 0.96,
            matchedText: 'Fotografía editorial de boda.',
            attributes: { provider_id: 173, country_key: 'mexico' },
            filename: '173-llum-studio.md',
          },
          {
            providerId: 142,
            score: 0.8,
            matchedText: 'Fotografía de bodas en Lima.',
            attributes: { provider_id: 142, country_key: 'peru' },
            filename: '142-agalux-studio.md',
          },
        ];
      },
      async searchQueryIntent(): Promise<ProviderVectorSearchResult[]> {
        return [];
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
        planId: 'plan-lurin-locality',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-lurin',
      }),
      {
        event_type: 'boda',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        location: 'Lurín, Lima, Perú',
        conversation_summary: 'Boda en Lurín; busca fotografía y video.',
      },
    );

    const result = await gateway.searchProviders(plan);

    expect(result.providers.map((provider) => provider.id)).toEqual([132, 142]);
    expect(result.providers.map((provider) => provider.location)).toEqual([
      'Lima, Perú',
      'Lima, Perú',
    ]);
    expect(result.providers.map((provider) => provider.id)).not.toContain(164);
    expect(result.providers.map((provider) => provider.id)).not.toContain(173);
  });
});
