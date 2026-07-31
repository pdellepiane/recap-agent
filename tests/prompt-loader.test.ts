import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

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
      expect(first.filePaths).toContain('shared/agent_personality.txt');
      expect(first.filePaths.indexOf('shared/agent_personality.txt')).toBeLessThan(
        first.filePaths.indexOf('shared/output_style.txt'),
      );
      expect(first.instructions.length).toBeGreaterThan(0);
      expect(first.instructions).toContain('Personalidad del agente');
      expect(first.instructions).toContain('Evita que el mensaje final termine con punto');
      expect(first.filePaths.some((filePath) => filePath.includes(`nodes/${node}/`))).toBe(true);
    }
  });

  it('uses personality prompt content in the bundle id so prompt cache invalidates on personality edits', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'recap-prompts-'));
    await fs.cp(promptsDir, tempRoot, { recursive: true });
    const tempLoader = new PromptLoader(tempRoot);
    const before = await tempLoader.loadNodeBundle('contacto_inicial');

    await fs.appendFile(
      path.join(tempRoot, 'shared/agent_personality.txt'),
      '\n\nMarca temporal de prueba para cache.\n',
      'utf8',
    );
    const after = await tempLoader.loadNodeBundle('contacto_inicial');

    expect(after.id).not.toBe(before.id);
  });

  it('includes explicit question scope and operational capability boundaries in prompt bundles', async () => {
    const informationBundle = await loader.loadNodeBundle(
      'resolver_consultas_informativas',
    );
    const welcomeBundle = await loader.loadNodeBundle('contacto_inicial');
    const extractorBundle = await loader.loadExtractorBundle();

    expect(informationBundle.instructions).toContain(
      'Resolver en un solo turno una o varias consultas informativas',
    );
    expect(informationBundle.instructions).toContain(
      'para poder acceder a “la información de tu cuenta”',
    );
    expect(informationBundle.instructions).toContain(
      'número de pedido',
    );
    expect(informationBundle.instructions).toContain(
      'No describas por adelantado todo el flujo',
    );
    expect(informationBundle.instructions).toContain(
      'puede tardar hasta un minuto',
    );
    expect(informationBundle.instructions).toContain(
      'bandeja principal o el correo no deseado',
    );
    expect(informationBundle.instructions).toContain(
      'Nunca menciones una bandeja de promociones',
    );
    expect(informationBundle.instructions).toContain(
      'No uses palabras técnicas como endpoint, API, JWT, token',
    );
    expect(informationBundle.instructions).toContain(
      'Nunca digas de forma general que no puedes ayudar con regalos',
    );
    expect(informationBundle.instructions).toContain(
      'La fuente exclusiva para compras es kind=purchase',
    );
    expect(informationBundle.instructions).not.toContain('plan.user_auth');
    expect(informationBundle.instructions).not.toContain('file_search');
    expect(extractorBundle.instructions).toContain(
      'informationRequests.kind=associated_event',
    );
    expect(extractorBundle.instructions).toContain(
      'report_otp_not_received',
    );
    expect(extractorBundle.instructions).toContain(
      'information_state.authentication_status=code_requested',
    );
    expect(welcomeBundle.instructions).toContain(
      'No prometas diseñar, construir ni editar sitios externos',
    );
    expect(welcomeBundle.instructions).toContain(
      'una sola pregunta abierta',
    );
    expect(welcomeBundle.instructions).toContain(
      'usar viñetas ni listas de capacidades',
    );
    expect(welcomeBundle.instructions).toContain(
      'diga explícitamente que eres el asistente de Sin Envolturas',
    );
    expect(welcomeBundle.instructions).toContain(
      'repetir entre campos una idea ya comunicada',
    );
    expect(informationBundle.instructions).toContain(
      'Conserva esas palabras en la respuesta',
    );
    expect(informationBundle.instructions).toContain(
      'Cada elemento de `guidance.requirements` es contenido obligatorio',
    );
    expect(informationBundle.instructions).toContain(
      'por seguridad se necesita el código para confirmar que la cuenta es de la persona',
    );
    expect(welcomeBundle.instructions).toContain('puedes usar un poquito de emojis');
    expect(welcomeBundle.instructions).toContain('evita que el mensaje final termine con punto');
    expect(extractorBundle.instructions).toContain(
      'una pregunta sobre capacidad no es una solicitud de atención humana',
    );
    expect(extractorBundle.instructions).toContain(
      'una referencia breve como "el horario"',
    );
    expect(extractorBundle.instructions).toContain(
      'pregunta si puedes leer una fotografía',
    );
    expect(extractorBundle.instructions).toContain(
      '“¿Cómo funciona la lista de regalos?” es FAQ',
    );
    expect(extractorBundle.instructions).toContain(
      '“¿Cuál es el estado del regalo que compré?” es purchase',
    );
    expect(extractorBundle.instructions).toContain(
      'El número es opcional',
    );
    expect(extractorBundle.instructions).toContain(
      'La ausencia de número de orden no es ambigüedad',
    );
    expect(extractorBundle.instructions).toContain(
      'aspects=[summary, payment_status, shipping]',
    );
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
    expect(bundle.filePaths).not.toContain('shared/agent_personality.txt');
    expect(bundle.filePaths).not.toContain('shared/output_style.txt');
    expect(bundle.instructions).not.toContain('Personalidad del agente');
    expect(bundle.allowedTools).toEqual([]);
  });

  it('does not expose unauthenticated event lookup as a model tool', () => {
    expect(toolNames).not.toContain('lookup_user_event_context');
    for (const config of Object.values(nodePromptManifest)) {
      expect(config.allowedTools).not.toContain('lookup_user_event_context');
    }
  });
});
