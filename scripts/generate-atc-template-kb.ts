import path from 'node:path';
import {
  buildAtcTemplateIngestion,
  loadLocalAtcTemplateExport,
  writeAtcSupplementalKnowledgeBase,
} from '../src/knowledge-sync/atc-templates';

const defaultSourcePath = '/Users/leonardocandio/Downloads/Private & Shared/Plantillas ATC';

function main(): void {
  const sourcePath = process.env.ATC_TEMPLATE_SOURCE_DIR ?? defaultSourcePath;
  const outputDir = process.env.ATC_TEMPLATE_KB_OUTPUT_DIR ?? path.resolve(process.cwd(), 'dist', 'knowledge-base-atc');
  const source = loadLocalAtcTemplateExport(sourcePath);
  const ingestion = buildAtcTemplateIngestion(source);
  const files = writeAtcSupplementalKnowledgeBase(ingestion, outputDir);

  console.log(`Generated ${files.length} supplemental ATC FAQ KB files in ${outputDir}`);
  console.log(`Excluded ${ingestion.deprecatedExcluded.length} Desestimado templates by default`);
  console.log(`Missing triggers reported: ${ingestion.qualityReport.missingTriggerTemplates.length}`);
}

main();
