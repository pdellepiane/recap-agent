import fs from 'node:fs';
import path from 'node:path';

export type AtcTemplateStatus = string;

export interface AtcTemplateSourceRow {
  title: string;
  actualizacion: string;
  canal: string;
  estado: AtcTemplateStatus;
  tipo: string;
  triggers: string[];
}

export interface LocalAtcTemplateSource {
  kind: 'local_export';
  basePath: string;
  rows: AtcTemplateSourceRow[];
  templateMarkdownByTitle: Map<string, string>;
}

export interface NormalizedAtcTemplate {
  title: string;
  slug: string;
  actualizacion: string;
  canal: string;
  estado: AtcTemplateStatus;
  tipo: string;
  triggers: string[];
  chatResponse: string;
}

export interface AtcTemplateQualityReport {
  missingTriggerTemplates: string[];
  missingMarkdownRows: string[];
  missingChatSectionRows: string[];
}

export interface AtcTemplateIngestionResult {
  chatListoRows: AtcTemplateSourceRow[];
  activeTemplates: NormalizedAtcTemplate[];
  deprecatedExcluded: NormalizedAtcTemplate[];
  qualityReport: AtcTemplateQualityReport;
}

interface CsvHeaderIndexes {
  correo: number;
  actualizacion: number;
  canal: number;
  estado: number;
  tipo: number;
  triggers: number;
}

const CHAT_SECTION_HEADING = 'Chat, WS y RRSS';

export function loadLocalAtcTemplateExport(basePath: string): LocalAtcTemplateSource {
  const csvPath = resolveExportCsvPath(basePath);
  const markdownDir = path.join(basePath, 'Plantillas');
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseAtcTemplateCsv(csvText);
  const templateMarkdownByTitle = loadMarkdownTemplates(markdownDir);

  return {
    kind: 'local_export',
    basePath,
    rows,
    templateMarkdownByTitle,
  };
}

export function buildAtcTemplateIngestion(source: LocalAtcTemplateSource): AtcTemplateIngestionResult {
  const chatListoRows = source.rows.filter(isChatListoRow);
  const activeTemplates: NormalizedAtcTemplate[] = [];
  const deprecatedExcluded: NormalizedAtcTemplate[] = [];
  const missingMarkdownRows: string[] = [];
  const missingChatSectionRows: string[] = [];

  for (const row of chatListoRows) {
    const markdown = source.templateMarkdownByTitle.get(normalizeTemplateTitle(row.title));
    if (!markdown) {
      missingMarkdownRows.push(row.title);
      continue;
    }

    const chatResponse = extractMarkdownSection(markdown, CHAT_SECTION_HEADING);
    if (!chatResponse) {
      missingChatSectionRows.push(row.title);
      continue;
    }

    const template: NormalizedAtcTemplate = {
      title: row.title,
      slug: slugify(row.title),
      actualizacion: row.actualizacion,
      canal: row.canal,
      estado: row.estado,
      tipo: row.tipo,
      triggers: row.triggers,
      chatResponse,
    };

    if (row.estado === 'Vigente') {
      activeTemplates.push(template);
    } else if (row.estado === 'Desestimado') {
      deprecatedExcluded.push(template);
    }
  }

  return {
    chatListoRows,
    activeTemplates,
    deprecatedExcluded,
    qualityReport: {
      missingTriggerTemplates: chatListoRows
        .filter((row) => row.triggers.length === 0)
        .map((row) => row.title),
      missingMarkdownRows,
      missingChatSectionRows,
    },
  };
}

export function formatAtcTemplateAsSupplementalMarkdown(template: NormalizedAtcTemplate): string {
  const frontmatter = [
    '---',
    `title: "${escapeYamlString(template.title)}"`,
    `slug: ${template.slug}`,
    'source: "atc_notion_template"',
    'article_type: customer_service_template',
    `template_status: "${escapeYamlString(template.estado)}"`,
    `channel: "${escapeYamlString(template.canal)}"`,
    `template_type: "${escapeYamlString(template.tipo)}"`,
    `semantic_trigger_hints: [${template.triggers.map((trigger) => `"${escapeYamlString(trigger)}"`).join(', ')}]`,
    '---',
  ];

  const triggerSection = template.triggers.length > 0
    ? template.triggers.map((trigger) => `- ${trigger}`).join('\n')
    : '- No trigger hints were present in the source export. Treat this as quality debt, not as an exclusion rule.';

  return [
    ...frontmatter,
    '',
    `# ${template.title}`,
    '',
    'Supplemental FAQ knowledge-base entry generated from an ATC/Notion customer-service response sample.',
    'Use the sample semantically when it fits the user question; do not use trigger hints as routing keys.',
    '',
    '## Semantic trigger hints',
    '',
    triggerSection,
    '',
    '## Customer-service response sample',
    '',
    template.chatResponse.trim(),
    '',
  ].join('\n');
}

export function writeAtcSupplementalKnowledgeBase(
  ingestion: AtcTemplateIngestionResult,
  outputDir: string,
): string[] {
  fs.mkdirSync(outputDir, { recursive: true });
  const writtenFiles: string[] = [];

  for (const template of ingestion.activeTemplates) {
    const filePath = path.join(outputDir, `atc-template-${template.slug}.md`);
    fs.writeFileSync(filePath, formatAtcTemplateAsSupplementalMarkdown(template), 'utf-8');
    writtenFiles.push(filePath);
  }

  fs.writeFileSync(
    path.join(outputDir, 'atc-template-quality-report.json'),
    `${JSON.stringify({
      activeCount: ingestion.activeTemplates.length,
      deprecatedExcludedCount: ingestion.deprecatedExcluded.length,
      missingTriggerTemplates: ingestion.qualityReport.missingTriggerTemplates,
      missingMarkdownRows: ingestion.qualityReport.missingMarkdownRows,
      missingChatSectionRows: ingestion.qualityReport.missingChatSectionRows,
    }, null, 2)}\n`,
    'utf-8',
  );

  return writtenFiles;
}

function resolveExportCsvPath(basePath: string): string {
  const entries = fs.readdirSync(basePath);
  const allCsv = entries.find((entry) => entry.endsWith('_all.csv'));
  const fallbackCsv = entries.find((entry) => entry.endsWith('.csv'));
  const selected = allCsv ?? fallbackCsv;
  if (!selected) {
    throw new Error(`No CSV export found in ${basePath}`);
  }
  return path.join(basePath, selected);
}

function loadMarkdownTemplates(markdownDir: string): Map<string, string> {
  const templates = new Map<string, string>();
  const entries = fs.readdirSync(markdownDir).filter((entry) => entry.endsWith('.md'));
  for (const entry of entries) {
    const filePath = path.join(markdownDir, entry);
    const markdown = fs.readFileSync(filePath, 'utf-8');
    const heading = markdown.match(/^#\s+(.+)$/m)?.[1];
    if (heading) {
      templates.set(normalizeTemplateTitle(heading), markdown);
    }
  }
  return templates;
}

function parseAtcTemplateCsv(csvText: string): AtcTemplateSourceRow[] {
  const records = parseCsvRecords(csvText).filter((record) => record.some((cell) => cell.trim().length > 0));
  const [header, ...body] = records;
  if (!header) {
    return [];
  }
  const indexes = resolveCsvHeaderIndexes(header);

  return body.map((record) => ({
    title: cell(record, indexes.correo),
    actualizacion: cell(record, indexes.actualizacion),
    canal: cell(record, indexes.canal),
    estado: cell(record, indexes.estado),
    tipo: cell(record, indexes.tipo),
    triggers: parseTriggerHints(cell(record, indexes.triggers)),
  }));
}

function parseCsvRecords(csvText: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      record.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

function resolveCsvHeaderIndexes(header: string[]): CsvHeaderIndexes {
  const normalized = header.map((value) => value.trim());
  return {
    correo: requiredHeader(normalized, 'Correo'),
    actualizacion: requiredHeader(normalized, 'Actualización'),
    canal: requiredHeader(normalized, 'Canal'),
    estado: requiredHeader(normalized, 'Estado'),
    tipo: requiredHeader(normalized, 'Tipo'),
    triggers: requiredHeader(normalized, 'Triggers'),
  };
}

function requiredHeader(header: string[], name: string): number {
  const index = header.indexOf(name);
  if (index === -1) {
    throw new Error(`Missing ATC template CSV header: ${name}`);
  }
  return index;
}

function cell(record: string[], index: number): string {
  return (record[index] ?? '').trim();
}

function parseTriggerHints(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*•\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function isChatListoRow(row: AtcTemplateSourceRow): boolean {
  const channels = row.canal.split(',').map((channel) => channel.trim());
  return row.actualizacion === 'Listo' && channels.includes('Chat');
}

function extractMarkdownSection(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `# ${heading}`);
  if (start === -1) {
    return null;
  }
  const sectionLines: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('# ')) {
      break;
    }
    sectionLines.push(line);
  }
  const section = sectionLines.join('\n').trim();
  return section.length > 0 ? section : null;
}

function normalizeTemplateTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'template';
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
