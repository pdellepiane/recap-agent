import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { decisionNodes } from '../src/core/decision-nodes';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { conversationSharedPromptFiles, extractorPromptFiles } from '../src/runtime/prompt-manifest';

describe('PromptLoader', () => {
  const promptsDir = path.resolve(process.cwd(), 'prompts');
  const loader = new PromptLoader(promptsDir);

  it('loads a deterministic bundle for every decision node', async () => {
    for (const node of decisionNodes) {
      const first = await loader.loadNodeBundle(node);
      const second = await loader.loadNodeBundle(node);

      expect(first.id).toBe(second.id);
      expect(first.filePaths.length).toBe(
        conversationSharedPromptFiles.length + 3,
      );
      expect(first.instructions.length).toBeGreaterThan(0);
      expect(first.filePaths.some((filePath) => filePath.includes(`nodes/${node}/`))).toBe(true);
    }
  });

  it('includes explicit FAQ scope and gift-claim policy in prompt bundles', async () => {
    const faqBundle = await loader.loadNodeBundle('consultar_faq');
    const invitedEventBundle = await loader.loadNodeBundle('consultar_evento_invitado');
    const welcomeBundle = await loader.loadNodeBundle('contacto_inicial');
    const extractorBundle = await loader.loadExtractorBundle();

    expect(faqBundle.instructions).toContain('no realizas diseño/desarrollo web externo');
    expect(faqBundle.instructions).toContain('no está obligado a comprar los regalos');
    expect(faqBundle.instructions).toContain('reclamo se gestiona directamente con la marca');
    expect(faqBundle.instructions).toContain('chat de la web');
    expect(faqBundle.instructions).toContain('hola@sinenvolturas.com');
    expect(invitedEventBundle.instructions).toContain('lookup_user_event_context');
    expect(invitedEventBundle.instructions).toContain('está invitado');
    expect(invitedEventBundle.instructions).toContain('incluye siempre un resumen compacto');
    expect(invitedEventBundle.instructions).toContain('ya está podado para ahorrar tokens');
    expect(extractorBundle.instructions).toContain('consultar_evento_invitado');
    expect(welcomeBundle.instructions).toContain('No prometas diseñar ni construir webs externas');
    expect(extractorBundle.instructions).toContain('diseñar una web externa');
    expect(extractorBundle.instructions).toContain('reclamos de productos');
  });

  it('loads extractor prompts without conversational style files', async () => {
    const bundle = await loader.loadExtractorBundle();

    expect(bundle.filePaths).toEqual(extractorPromptFiles);
    expect(bundle.filePaths).not.toContain('shared/output_style.txt');
    expect(bundle.allowedTools).toEqual([]);
  });
});
