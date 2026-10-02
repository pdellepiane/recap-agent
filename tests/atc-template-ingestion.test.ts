import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildAtcTemplateIngestion,
  loadLocalAtcTemplateExport,
} from '../src/knowledge-sync/atc-templates';

const exportPath = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-audit-'));
const markdownPath = path.join(exportPath, 'Plantillas');
fs.mkdirSync(markdownPath);
fs.writeFileSync(path.join(exportPath, 'templates_all.csv'), [
  'Correo,Actualización,Canal,Estado,Tipo,Triggers',
  'Active,Listo,Chat,Vigente,Informativa,policy',
  'Deprecated,Listo,Chat,Desestimado,Informativa,old',
  'Not ready,Pendiente,Chat,Vigente,Informativa,',
  'Email,Listo,Correo,Vigente,Informativa,',
  'Missing file,Listo,Chat,Vigente,Informativa,',
  'Missing section,Listo,Chat,Vigente,Informativa,',
].join('\n'));
fs.writeFileSync(path.join(markdownPath, 'active.md'), '# Active\n\n# Chat, WS y RRSS\n\nCase-specific sample, for audit only.\n\n# Correo\n\nEmail sample.');
fs.writeFileSync(path.join(markdownPath, 'deprecated.md'), '# Deprecated\n\n# Chat, WS y RRSS\n\nDeprecated sample.');
fs.writeFileSync(path.join(markdownPath, 'missing-section.md'), '# Missing section\n\n# Correo\n\nEmail only.');
afterAll(() => fs.rmSync(exportPath, { recursive: true, force: true }));

describe('ATC export audit reader', () => {
  it('inventories eligible and deprecated samples without promoting them into knowledge', () => {
    const source = loadLocalAtcTemplateExport(exportPath);
    const ingestion = buildAtcTemplateIngestion(source);
    expect(source.rows).toHaveLength(6);
    expect(ingestion.chatListoRows).toHaveLength(4);
    expect(ingestion.activeTemplates.map((entry) => entry.title)).toEqual(['Active']);
    expect(ingestion.deprecatedExcluded.map((entry) => entry.title)).toEqual(['Deprecated']);
    expect(ingestion.activeTemplates[0]?.chatResponse).toBe('Case-specific sample, for audit only.');
    expect(ingestion.qualityReport.missingMarkdownRows).toEqual(['Missing file']);
    expect(ingestion.qualityReport.missingChatSectionRows).toEqual(['Missing section']);
  });

  it('reports missing trigger metadata without excluding those rows from the audit', () => {
    const ingestion = buildAtcTemplateIngestion(loadLocalAtcTemplateExport(exportPath));
    expect(ingestion.qualityReport.missingTriggerTemplates).toEqual(['Missing file', 'Missing section']);
    expect(ingestion.chatListoRows.map((entry) => entry.title)).toContain('Missing file');
  });

  it('reads the original export without rewriting it or producing knowledge files', () => {
    const before = fs.readFileSync(path.join(markdownPath, 'active.md'), 'utf8');
    const source = loadLocalAtcTemplateExport(exportPath);
    expect(source.basePath).toBe(exportPath);
    expect(fs.readFileSync(path.join(markdownPath, 'active.md'), 'utf8')).toBe(before);
    expect(fs.readdirSync(exportPath).sort()).toEqual(['Plantillas', 'templates_all.csv']);
  });
});
