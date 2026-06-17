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

  it('formats supplemental FAQ files without appending to existing scraped FAQ docs', () => {
    const source = loadLocalAtcTemplateExport(localExportPath);
    const ingestion = buildAtcTemplateIngestion(source);
    const sample = ingestion.activeTemplates[0];
    expect(sample).toBeDefined();

    const markdown = formatAtcTemplateAsSupplementalMarkdown(sample);

    expect(markdown).toContain('source: "atc_notion_template"');
    expect(markdown).toContain('article_type: customer_service_template');
    expect(markdown).toContain('## Customer-service response sample');
    expect(markdown).toContain(sample.chatResponse.trim());
  });

  it('keeps the source export outside generated output paths', () => {
    const source = loadLocalAtcTemplateExport(localExportPath);

    expect(source.templateMarkdownByTitle.size).toBeGreaterThan(0);
    expect(path.basename(source.basePath)).toBe('Plantillas ATC');
  });
});
