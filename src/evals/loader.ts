import fs from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import {
  evalCaseSchema,
  evalMatrixSchema,
  evalSuiteManifestSchema,
  type EvalCase,
  type EvalMatrix,
  type EvalSuiteManifest,
} from './case-schema';

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };

export type LoadedEvalCatalog = {
  templates: Map<string, EvalCase>;
  cases: EvalCase[];
  suites: EvalSuiteManifest[];
};

export class EvalLoader {
  constructor(private readonly baseDir: string) {}

  async loadCatalog(): Promise<LoadedEvalCatalog> {
    const templates = await this.loadTemplates();
    const cases = await this.loadCases(templates);
    const suites = await this.loadSuites();

    return {
      templates,
      cases,
      suites,
    };
  }

  async loadMatrix(relativePath: string): Promise<EvalMatrix> {
    const parsed = await this.readStructuredFile(path.join(this.baseDir, relativePath));
    return evalMatrixSchema.parse(parsed);
  }

  private async loadTemplates(): Promise<Map<string, EvalCase>> {
    const templatesDir = path.join(this.baseDir, 'templates');
    const files = await this.listStructuredFiles(templatesDir);
    const templates = new Map<string, EvalCase>();

    for (const filePath of files) {
      const parsed = await this.readStructuredFile(filePath);
      const parsedRecord =
        parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      const imported = await this.resolveImports(parsedRecord, filePath);
      const withoutImports = Object.fromEntries(
        Object.entries(parsedRecord).filter(([key]) => key !== 'imports'),
      );
      const template = evalCaseSchema.parse(this.deepMerge(imported, withoutImports));
      templates.set(template.id, template);
    }

    return templates;
  }

  private async loadCases(templates: Map<string, EvalCase>): Promise<EvalCase[]> {
    const casesDir = path.join(this.baseDir, 'cases');
    const files = await this.listStructuredFiles(casesDir);
    const cases: EvalCase[] = [];

    for (const filePath of files) {
      const parsed = await this.readStructuredFile(filePath);
      const hydrated = await this.hydrateCase(parsed, templates, filePath);
      cases.push(evalCaseSchema.parse(hydrated));
    }

    return cases.sort((left, right) => left.id.localeCompare(right.id));
  }

  private async loadSuites(): Promise<EvalSuiteManifest[]> {
    const suitesDir = path.join(this.baseDir, 'suites');
    const files = await this.listStructuredFiles(suitesDir);
    const manifests: EvalSuiteManifest[] = [];

    for (const filePath of files) {
      const parsed = await this.readStructuredFile(filePath);
      manifests.push(evalSuiteManifestSchema.parse(parsed));
    }

    return manifests.sort((left, right) => left.id.localeCompare(right.id));
  }

  private async hydrateCase(
    rawCase: unknown,
    templates: Map<string, EvalCase>,
    sourcePath?: string,
  ): Promise<unknown> {
    const candidate = rawCase as Record<string, unknown>;
    const imported = await this.resolveImports(candidate, sourcePath);
    const templateId =
      typeof candidate.template === 'string' && candidate.template.trim().length > 0
        ? candidate.template
        : null;

    const merged = templateId
      ? this.deepMerge(this.deepMerge(templates.get(templateId) ?? null, imported), candidate)
      : this.deepMerge(imported, candidate);
    const variables = this.collectVariables(merged);
    return this.interpolateValue(merged, variables);
  }

  private collectVariables(candidate: unknown): Record<string, string> {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return {};
    }
    const variables = 'variables' in candidate ? candidate.variables : undefined;
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
      return {};
    }

    return Object.fromEntries(buildVariableEntries(variables));
  }

  private interpolateValue(value: unknown, variables: Record<string, string>): unknown {
    if (typeof value === 'string') {
      return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
        variables[key] ?? _match,
      );
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.interpolateValue(entry, variables));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, this.interpolateValue(entry, variables)]),
      );
    }

    return value;
  }

  private async resolveImports(
    candidate: Record<string, unknown>,
    sourcePath?: string,
    visited: Set<string> = new Set(),
  ): Promise<unknown> {
    const importPaths = Array.isArray(candidate.imports)
      ? candidate.imports.filter((value): value is string => typeof value === 'string')
      : [];
    const sourceDir = sourcePath ? path.dirname(sourcePath) : this.baseDir;
    let merged: unknown = null;

    for (const relativeImportPath of importPaths) {
      const absolutePath = path.resolve(sourceDir, relativeImportPath);
      if (visited.has(absolutePath)) {
        throw new Error(`Circular eval import detected for "${absolutePath}".`);
      }
      visited.add(absolutePath);
      const importedRaw = await this.readStructuredFile(absolutePath);
      const importedRecord =
        importedRaw && typeof importedRaw === 'object'
          ? (importedRaw as Record<string, unknown>)
          : {};
      const nestedImports = await this.resolveImports(importedRecord, absolutePath, visited);
      const withoutImports = Object.fromEntries(
        Object.entries(importedRecord).filter(([key]) => key !== 'imports'),
      );
      merged = this.deepMerge(merged, this.deepMerge(nestedImports, withoutImports));
      visited.delete(absolutePath);
    }

    return merged;
  }

  private deepMerge(base: unknown, override: unknown): unknown {
    if (base === null || base === undefined) {
      return override;
    }

    if (override === null || override === undefined) {
      return base;
    }

    if (Array.isArray(base) || Array.isArray(override)) {
      return override;
    }

    if (typeof base === 'object' && typeof override === 'object') {
      const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
      for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
        merged[key] = this.deepMerge(merged[key], value);
      }
      return merged;
    }

    return override;
  }

  private async listStructuredFiles(directory: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && /\.(json|ya?ml)$/u.test(entry.name))
        .map((entry) => path.join(directory, entry.name))
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async readStructuredFile(filePath: string): Promise<unknown> {
    const content = await fs.readFile(filePath, 'utf8');
    if (filePath.endsWith('.json')) {
      return JSON.parse(content) as unknown;
    }
    return YAML.parse(content) as unknown;
  }
}

function stringifyVariable(value: JsonLike): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return JSON.stringify(value);
}

function buildVariableEntries(variables: object): Array<[string, string]> {
  return Object.entries(variables).map(([key, value]) => [key, stringifyVariable(toJsonLike(value))]);
}

function toJsonLike(value: unknown): JsonLike {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonLike(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, toJsonLike(nestedValue)]),
    );
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'symbol') {
    return value.description ?? 'symbol';
  }
  return 'unsupported';
}
