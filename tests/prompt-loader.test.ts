import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { decisionNodes } from '../src/core/decision-nodes';
import { PromptLoader } from '../src/runtime/prompt-loader';
import {
  conversationPromptFilesForNode,
  conversationSharedPromptFiles,
  extractorPromptFiles,
  nodePromptManifest,
  promptRuleIdForFile,
  responseClassifierPromptFiles,
  toolNames,
} from '../src/runtime/prompt-manifest';

describe('PromptLoader', () => {
  const promptsDir = path.resolve(process.cwd(), 'prompts');
  const loader = new PromptLoader(promptsDir);

  it('loads a deterministic bundle for every decision node', async () => {
    for (const node of decisionNodes) {
      const first = await loader.loadNodeBundle(node);
      const second = await loader.loadNodeBundle(node);

      expect(first.id).toBe(second.id);
      expect(first.filePaths.length).toBe(
        conversationPromptFilesForNode(node).length + 3,
      );
      expect(first.ruleIds).toHaveLength(first.filePaths.length);
      expect(new Set(first.ruleIds).size).toBe(first.ruleIds.length);
      expect(first.filePaths).toContain('shared/agent_personality.txt');
      expect(first.filePaths.indexOf('shared/agent_personality.txt')).toBeLessThan(
        first.filePaths.indexOf('shared/output_style.txt'),
      );
      expect(first.instructions.length).toBeGreaterThan(0);
      expect(first.instructions).toContain('Personalidad del agente');
      expect(first.instructions).toContain('evita que el mensaje final termine con punto');
      expect(first.filePaths.some((filePath) => filePath.includes(`nodes/${node}/`))).toBe(true);
    }
  });

  it('owns one explicit Spanish-only contract in the output-style prompt', async () => {
    const bundle = await loader.loadNodeBundle('contacto_inicial');
    const spanishOnlyRule =
      'escribe exclusivamente en español: traduce todo término común en inglés aunque lo use el usuario; no lo cites ni lo repitas';

    expect(bundle.instructions).toContain(spanishOnlyRule);
    expect(bundle.instructions).toContain(
      'conserva solo nombres propios, proveedores, marcas sin traducción oficial',
    );
    expect(bundle.instructions).toContain(
      'correos, URL, números y códigos literales',
    );
    expect(bundle.instructions.split(spanishOnlyRule)).toHaveLength(2);
    expect(bundle.instructions).not.toContain('Debes responder siempre en español');
  });

  it('assigns every prompt file one stable rule ID and one owner', () => {
    const ownedFiles = [
      ...conversationSharedPromptFiles,
      ...extractorPromptFiles,
      ...Object.values(nodePromptManifest).flatMap((config) => config.files),
      ...Object.values(responseClassifierPromptFiles).flat(),
    ];
    const uniqueFiles = new Set(ownedFiles);
    const ruleIds = [...uniqueFiles].map(promptRuleIdForFile);

    expect(uniqueFiles.size).toBe(ownedFiles.length);
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
    expect(promptRuleIdForFile('shared/base_system.txt')).toBe(
      'prompt.shared.base_system',
    );
  });

  it('loads an outcome-specific campaign classifier bundle', async () => {
    const general = await loader.loadResponseClassifierBundle('general');
    const campaign = await loader.loadResponseClassifierBundle('campaign_reply');

    expect(general.filePaths).toEqual([
      'nodes/deteccion_intencion/response_classifier.txt',
    ]);
    expect(campaign.filePaths).toEqual([
      'nodes/deteccion_intencion/response_classifier_campaign.txt',
    ]);
    expect(campaign.instructions).toContain('campaign_reply_kind');
    expect(campaign.instructions).toContain('declines_campaign_offer');
    expect(campaign.instructions).not.toContain('generic_corporate_reception');
    expect(Buffer.byteLength(campaign.instructions, 'utf8'))
      .toBeLessThan(Buffer.byteLength(general.instructions, 'utf8') / 2);
  });

  it('loads only shared policies relevant to the current route', async () => {
    const welcome = await loader.loadNodeBundle('contacto_inicial');
    const information = await loader.loadNodeBundle('resolver_consultas_informativas');
    const interview = await loader.loadNodeBundle('entrevista');
    const recommendation = await loader.loadNodeBundle('recomendar');

    for (const bundle of [welcome, information]) {
      expect(bundle.filePaths).not.toContain('shared/domain_knowledge.txt');
      expect(bundle.filePaths).not.toContain('shared/flow_discipline.txt');
      expect(bundle.filePaths).not.toContain('shared/question_strategy.txt');
    }
    expect(information.instructions).toContain(
      'indica directamente todos los valores aplicables presentes en la evidencia',
    );
    expect(information.instructions).toContain(
      'Nunca sustituyas los valores disponibles por frases vagas',
    );
    expect(interview.filePaths).toContain('shared/domain_knowledge.txt');
    expect(interview.filePaths).toContain('shared/flow_discipline.txt');
    expect(interview.filePaths).toContain('shared/question_strategy.txt');
    expect(recommendation.filePaths).toContain('shared/domain_knowledge.txt');
    expect(recommendation.filePaths).not.toContain('shared/question_strategy.txt');
  });

  it('has no repeated normalized paragraphs inside any route bundle', async () => {
    for (const node of decisionNodes) {
      const bundle = await loader.loadNodeBundle(node);
      const paragraphs = bundle.instructions
        .split(/\n\s*\n/gu)
        .map((paragraph) => paragraph
          .replace(/^## .*\n/gu, '')
          .replace(/\s+/gu, ' ')
          .trim()
          .toLocaleLowerCase('es'))
        .filter(Boolean);
      const duplicates = paragraphs.filter(
        (paragraph, index) => paragraphs.indexOf(paragraph) !== index,
      );

      expect(duplicates, `duplicate prompt paragraphs for ${node}`).toEqual([]);
    }
  });

  it('omits irrelevant information outcome guidance from the current bundle', async () => {
    const invalidCode = await loader.loadNodeBundle(
      'resolver_consultas_informativas',
      { informationAuthReasons: ['otp_invalid'] },
    );
    const resentCode = await loader.loadNodeBundle(
      'resolver_consultas_informativas',
      { informationAuthReasons: ['otp_resent'] },
    );

    expect(invalidCode.instructions).toContain(
      'ofrece reintentar, reenviar o cambiar el correo',
    );
    expect(invalidCode.instructions).not.toContain('puede tardar hasta un minuto');
    expect(invalidCode.instructions).not.toContain(
      'se alcanzó temporalmente el límite de solicitudes',
    );
    expect(resentCode.instructions).toContain('Te envié un código');
    expect(resentCode.instructions).not.toContain(
      'ofrece reintentar, reenviar o cambiar el correo',
    );
    expect(resentCode.instructions).not.toContain(
      '¿Quieres que lo reenvíe',
    );
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
      {
        informationAuthReasons: [
          'otp_sent',
          'otp_resent',
          'otp_pending',
          'otp_invalid',
        ],
      },
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
      'No uses la palabra “texto”',
    );
    expect(informationBundle.instructions).toContain(
      'no puedes leer imágenes ni capturas',
    );
    expect(informationBundle.instructions).toContain(
      'Cópialo y pégalo aquí',
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
    expect(informationBundle.instructions).not.toContain(
      'ofrece reenviar el código o cambiar el correo',
    );
    expect(extractorBundle.instructions).toContain('accountless_user');
    expect(extractorBundle.instructions).toContain('decline_authentication');
    expect(extractorBundle.instructions).toContain(
      '`phoneConfirmation=no` solo si niega que la cuenta o el número actuales sean suyos',
    );
    expect(extractorBundle.instructions).toContain(
      '`decline_authentication` si rechaza continuar la verificación',
    );
    expect(extractorBundle.instructions).toContain(
      'usa `phoneConfirmation=no` y no `decline_authentication`',
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
    expect(extractorBundle.instructions).toContain('orderId=null');
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

  it('projects reset extraction guidance only into provider-planning calls', async () => {
    const planning = await loader.loadExtractorBundle({
      information: false,
      rsvp: false,
      providerPlanning: true,
      providerOperations: false,
      providerSelection: false,
      providerInspection: false,
      contact: false,
      close: false,
      pause: false,
    });
    const conversationOnly = await loader.loadExtractorBundle({
      information: true,
      rsvp: false,
      providerPlanning: false,
      providerOperations: false,
      providerSelection: false,
      providerInspection: false,
      contact: false,
      close: false,
      pause: false,
    });

    expect(planning.instructions).toContain('`reset_plan`');
    expect(conversationOnly.instructions).not.toContain('`reset_plan`');
    expect(conversationOnly.filePaths).not.toContain('extractors/planning.txt');
  });

  it('does not expose unauthenticated event lookup as a model tool', () => {
    expect(toolNames).not.toContain('lookup_user_event_context');
    for (const config of Object.values(nodePromptManifest)) {
      expect(config.allowedTools).not.toContain('lookup_user_event_context');
    }
  });
});
