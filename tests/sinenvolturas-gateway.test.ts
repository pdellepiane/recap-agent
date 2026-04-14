import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
