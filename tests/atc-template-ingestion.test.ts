import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAtcTemplateIngestion,
  formatAtcTemplateAsSupplementalMarkdown,
  loadLocalAtcTemplateExport,
} from '../src/knowledge-sync/atc-templates';

const localExportPath = '/Users/leonardocandio/Downloads/Private & Shared/Plantillas ATC';

describe('ATC template local export ingestion', () => {
  it('validates production inclusion and default drop rules from the local export', () => {
    expect(fs.existsSync(localExportPath)).toBe(true);

    const source = loadLocalAtcTemplateExport(localExportPath);
    const ingestion = buildAtcTemplateIngestion(source);

    expect(source.rows).toHaveLength(54);
    expect(ingestion.chatListoRows).toHaveLength(30);
    expect(ingestion.activeTemplates).toHaveLength(27);
    expect(ingestion.deprecatedExcluded).toHaveLength(3);
    expect(ingestion.qualityReport.missingTriggerTemplates).toHaveLength(9);
    expect(ingestion.qualityReport.missingMarkdownRows).toHaveLength(0);
    expect(ingestion.qualityReport.missingChatSectionRows).toHaveLength(0);
    expect(
      ingestion.activeTemplates.every((template) => template.estado === 'Vigente'),
    ).toBe(true);
    expect(
      ingestion.deprecatedExcluded.every((template) => template.estado === 'Desestimado'),
    ).toBe(true);
  });

  it('treats triggers as semantic hints and missing triggers as quality debt', () => {
    const source = loadLocalAtcTemplateExport(localExportPath);
    const ingestion = buildAtcTemplateIngestion(source);
    const withoutTriggers = ingestion.chatListoRows.filter(
      (row) => row.triggers.length === 0,
    );

    expect(withoutTriggers.length).toBeGreaterThan(0);
    expect(withoutTriggers.length).toBeLessThan(ingestion.chatListoRows.length);
    expect(ingestion.qualityReport.missingTriggerTemplates).toEqual(
      withoutTriggers.map((row) => row.title),
    );
  });

  it('formats supplemental FAQ files as factual policy evidence without frontmatter or response scripts', () => {
    const source = loadLocalAtcTemplateExport(localExportPath);
    const ingestion = buildAtcTemplateIngestion(source);
    const sample = ingestion.activeTemplates[0];
    expect(sample).toBeDefined();

    const markdown = formatAtcTemplateAsSupplementalMarkdown(sample);

    expect(markdown).toContain(`# ${sample.title}`);
    expect(markdown).toContain('## Hechos de la política');
    expect(markdown).toContain(`Estado: ${sample.estado}`);
    expect(markdown).toContain(`Canal: ${sample.canal}`);
    const strippedFacts = sample.chatResponse.trim().replace(/\[[^\n[\]]*\]/gu, '').trim();
    expect(strippedFacts.length).toBeGreaterThan(0);
    const normalize = (value: string): string => value.replace(/\s+/gu, ' ');
    expect(normalize(markdown)).toContain(normalize(strippedFacts));
    expect(markdown).not.toContain('---');
    expect(markdown).not.toContain('semantic_trigger_hints');
    expect(markdown).not.toContain('article_type');
    expect(markdown).not.toContain('## Semantic trigger hints');
    expect(markdown).not.toContain('## Customer-service response sample');
    expect(markdown).not.toContain('routing keys');
  });

  it('strips bracketed alternatives while preserving policy facts', () => {
    const template = {
      title: 'Retiro de fondos',
      slug: 'retiro-de-fondos',
      actualizacion: 'Listo',
      canal: 'Chat',
      estado: 'Vigente',
      tipo: 'Informativa',
      triggers: ['retiro'],
      chatResponse: 'Hola [Nombre], las solicitudes se procesan en hasta 72 horas hábiles [opción A/opción B].',
    };
    const markdown = formatAtcTemplateAsSupplementalMarkdown(template);

    expect(markdown).toContain('las solicitudes se procesan en hasta 72 horas hábiles');
    expect(markdown).not.toContain('[');
    expect(markdown).not.toContain('"retiro"');
    expect(markdown).not.toContain('- retiro');
    expect(markdown).toContain('Estado: Vigente');
  });

  it('keeps the source export outside generated output paths', () => {
    const source = loadLocalAtcTemplateExport(localExportPath);

    expect(source.templateMarkdownByTitle.size).toBeGreaterThan(0);
    expect(path.basename(source.basePath)).toBe('Plantillas ATC');
  });
});
