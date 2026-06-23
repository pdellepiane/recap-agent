import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { decisionNodes } from '../src/core/decision-nodes';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { conversationSharedPromptFiles, extractorPromptFiles, nodePromptManifest, toolNames } from '../src/runtime/prompt-manifest';

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
    expect(faqBundle.instructions).toContain('beneficios, descuentos, Shop');
    expect(faqBundle.instructions).toContain('transmisión en vivo');
    expect(faqBundle.instructions).toContain('tipos de regalos');
    expect(invitedEventBundle.instructions).toContain('Contexto verificado de evento asociado');
    expect(invitedEventBundle.instructions).toContain('Ninguna.');
    expect(invitedEventBundle.instructions).toContain('eventos de Sin Envolturas asociados');
    expect(invitedEventBundle.instructions).toContain('nombre, url, lugar, fecha');
    expect(invitedEventBundle.instructions).toContain('asistencia confirmada');
    expect(invitedEventBundle.instructions).toContain('acompañantes indicado/no indicado');
    expect(invitedEventBundle.instructions).not.toContain('plan.guest_auth');
    expect(invitedEventBundle.instructions).not.toContain('código');
    expect(invitedEventBundle.instructions).not.toContain('consultar_evento_invitado');
    expect(extractorBundle.instructions).toContain('consultar_evento_invitado');
    expect(welcomeBundle.instructions).toContain('No prometas diseñar ni construir webs externas');
    expect(extractorBundle.instructions).toContain('diseñar una web externa');
    expect(extractorBundle.instructions).toContain('reclamos de productos');
    expect(extractorBundle.instructions).toContain('dónde veo los confirmados');
    expect(extractorBundle.instructions).toContain('tengo un problema con mi evento');
    expect(extractorBundle.instructions).toContain('no puedo compartir mi evento');
    expect(extractorBundle.instructions).toContain('mis invitados');
    expect(extractorBundle.instructions).toContain('no reemplaces nombres de proveedores desconocidos');
    expect(extractorBundle.instructions).toContain('no quiero quedarme con X');
    expect(extractorBundle.instructions).toContain('respuestas negativas como "ninguna"');
    expect(welcomeBundle.instructions).toContain('presupuesto o cantidad aproximada de invitados');
  });

  it('keeps multi-front prompt guidance enabled for explicit parallel needs', async () => {
    const bundle = await loader.loadNodeBundle('entrevista');

    expect(bundle.instructions).toContain('menciona varios servicios explícitos');
    expect(bundle.instructions).toContain('avanza con todos los que estén listos');
    expect(bundle.instructions).not.toContain('no intentes resolverlos todos en un turno');
  });

  it('loads extractor prompts without conversational style files', async () => {
    const bundle = await loader.loadExtractorBundle();

    expect(bundle.filePaths).toEqual(extractorPromptFiles);
    expect(bundle.filePaths).not.toContain('shared/output_style.txt');
    expect(bundle.allowedTools).toEqual([]);
  });

  it('does not expose unauthenticated event lookup as a model tool', () => {
    expect(toolNames).not.toContain('lookup_user_event_context');
    for (const config of Object.values(nodePromptManifest)) {
      expect(config.allowedTools).not.toContain('lookup_user_event_context');
    }
  });
});
