import { afterEach, describe, expect, it, vi } from 'vitest';

import { TawkHelpScraper } from '../src/knowledge-sync/scraper';

const articleHtml = `<!doctype html>
<html><body>
<h1>¿Cuánto cuesta?</h1>
<div class="category-crumb last-path"><a><span>General</span></a></div>
<div id="article-wrapper">
<div class="content-block"><div class="paragraph-block"><p>Crearte una cuenta es gratis.</p></div></div>
<div class="content-block"><div style="overflow:auto;"><table><tbody>
<tr><td><b>Método de pago</b></td><td><b>Comisión Variable</b></td><td><b>Comisión Fija</b></td></tr>
<tr><td>Tarjeta de crédito o débito</td><td>3.59%</td><td>0.50 en soles<br />4.00 en pesos<br />0.40 en USD</td></tr>
<tr><td>Transferencia</td><td>1.9%</td><td></td></tr>
</tbody></table></div></div>
<div class="content-block"><div class="paragraph-block"><p>Revisa nuestra <a href="https://sinenvolturas.com/cost-of-service" target="_blank">calculadora de comisiones</a> para otros montos.</p></div></div>
<div class="content-block"><div class="paragraph-block"><p>Ignora <a href="javascript:void(0);">este enlace</a> roto.</p></div></div>
</div>
<div class="time">Última actualización hace un mes</div>
</body></html>`;

function stubFetch(html: string): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => html,
  })));
}

describe('TawkHelpScraper fidelity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves tables as markdown with flattened multi-line cells', async () => {
    stubFetch(articleHtml);
    const scraper = new TawkHelpScraper('https://sinenvolturas.tawk.help');
    const article = await scraper.scrapeArticle('cuanto-cuesta');
    expect(article.content).toContain('| Método de pago | Comisión Variable | Comisión Fija |');
    expect(article.content).toContain('| --- | --- | --- |');
    expect(article.content).toContain(
      '| Tarjeta de crédito o débito | 3.59% | 0.50 en soles; 4.00 en pesos; 0.40 en USD |',
    );
    expect(article.content).toContain('| Transferencia | 1.9% |  |');
  });

  it('preserves article links as markdown and drops javascript hrefs', async () => {
    stubFetch(articleHtml);
    const scraper = new TawkHelpScraper('https://sinenvolturas.tawk.help');
    const article = await scraper.scrapeArticle('cuanto-cuesta');
    expect(article.content).toContain(
      '[calculadora de comisiones](https://sinenvolturas.com/cost-of-service)',
    );
    expect(article.content).not.toContain('javascript:');
    expect(article.content).toContain('este enlace');
  });
});
