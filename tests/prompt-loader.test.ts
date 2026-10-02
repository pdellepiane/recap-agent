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
      expect(first.instructions).toContain('Resuelve lo que puedas de la solicitud');
      expect(first.filePaths.some((filePath) => filePath.includes(`nodes/${node}/`))).toBe(true);
    }
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

  it('re-reads edited prompt files so the bundle id invalidates instead of serving stale bytes', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'recap-prompts-o4-'));
    await fs.cp(promptsDir, tempRoot, { recursive: true });
    const tempLoader = new PromptLoader(tempRoot);
    const before = await tempLoader.loadNodeBundle('contacto_inicial');
    await fs.appendFile(
      path.join(tempRoot, 'shared/agent_personality.txt'),
      '\n\nMarca temporal de prueba para cache O4.\n',
      'utf8',
    );
    const after = await tempLoader.loadNodeBundle('contacto_inicial');
    expect(after.id).not.toBe(before.id);
    expect(after.instructions).toContain('Marca temporal de prueba para cache O4');

    // Personality content feeds the bundle id, so a second personality edit
    // invalidates the cache again rather than reusing the prior bundle.
    await fs.appendFile(
      path.join(tempRoot, 'shared/agent_personality.txt'),
      '\n\nMarca temporal de prueba para cache.\n',
      'utf8',
    );
    const third = await tempLoader.loadNodeBundle('contacto_inicial');
    expect(third.id).not.toBe(after.id);
    expect(third.id).not.toBe(before.id);
  });

  it('scopes extractor bundles to their profile without style files or cross-profile guidance', async () => {
    const planningBundle = await loader.loadExtractorBundle({
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

    expect(planningBundle.instructions).not.toContain(
      'Retiro: política/plazo/estado → `faq`',
    );
    expect(planningBundle.instructions).not.toContain(
      'Código de transacción `COD301816`/`301816`',
    );
    // Reset guidance belongs to this planning profile only.
    expect(planningBundle.instructions).toContain('`reset_plan`');

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
    expect(conversationOnly.instructions).not.toContain('`reset_plan`');
    expect(conversationOnly.filePaths).not.toContain('extractors/planning.txt');

    // No conversational style files ride any extractor bundle.
    const bundle = await loader.loadExtractorBundle();
    expect(bundle.filePaths).toEqual(extractorPromptFiles);
    expect(bundle.filePaths).not.toContain('shared/agent_personality.txt');
    expect(bundle.filePaths).not.toContain('shared/output_style.txt');
    expect(bundle.instructions).not.toContain('Personalidad del agente');
    expect(bundle.allowedTools).toEqual([]);
  });

  it('keeps multi-front prompt guidance enabled for explicit parallel needs', async () => {
    const bundle = await loader.loadNodeBundle('entrevista');

    expect(bundle.instructions).toContain('menciona varios servicios explícitos');
    expect(bundle.instructions).toContain('avanza con todos los que estén listos');
    expect(bundle.instructions).not.toContain('no intentes resolverlos todos en un turno');
  });

  it('does not expose unauthenticated event lookup as a model tool', () => {
    expect(toolNames).not.toContain('lookup_user_event_context');
    for (const config of Object.values(nodePromptManifest)) {
      expect(config.allowedTools).not.toContain('lookup_user_event_context');
    }
  });
});
