import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';

export type OpenAiSchemaCompatibilityIssue = {
  path: string;
  message: string;
};

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'oneOf',
  'allOf',
  'not',
  'dependentRequired',
  'dependentSchemas',
  'if',
  'then',
  'else',
]);

export function buildOpenAiTextSchema(schema: z.ZodType, name: string): unknown {
  const format = zodTextFormat(schema, name);
  return format.schema;
}

export function assertOpenAiStructuredSchemaCompatible(
  schema: z.ZodType,
  name: string,
): void {
  let jsonSchema: unknown;
  try {
    jsonSchema = buildOpenAiTextSchema(schema, name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAI structured schema "${name}" failed conversion: ${message}`);
  }

  const issues = validateOpenAiStructuredJsonSchema(jsonSchema);
  if (issues.length > 0) {
    const details = issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('\n');
    throw new Error(`OpenAI structured schema "${name}" is not compatible:\n${details}`);
  }
}

export function validateOpenAiStructuredJsonSchema(
  jsonSchema: unknown,
): OpenAiSchemaCompatibilityIssue[] {
  const issues: OpenAiSchemaCompatibilityIssue[] = [];
  if (!isRecord(jsonSchema)) {
    return [{ path: '$', message: 'schema must be an object' }];
  }
  if (jsonSchema.type !== 'object') {
    issues.push({ path: '$.type', message: 'root schema type must be object' });
  }
  if ('anyOf' in jsonSchema) {
    issues.push({ path: '$.anyOf', message: 'root schema must not use anyOf' });
  }
  walkSchema(jsonSchema, '$', issues);
  return issues;
}

function walkSchema(
  schema: Record<string, unknown>,
  path: string,
  issues: OpenAiSchemaCompatibilityIssue[],
): void {
  for (const key of Object.keys(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: `${key} is not supported by OpenAI structured outputs`,
      });
    }
  }

  if (schema.type === 'object') {
    validateObjectSchema(schema, path, issues);
  }

  const properties = schema.properties;
  if (isRecord(properties)) {
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (isRecord(propertySchema)) {
        walkSchema(propertySchema, `${path}.properties.${key}`, issues);
      }
    }
  }

  const items = schema.items;
  if (isRecord(items)) {
    walkSchema(items, `${path}.items`, issues);
  }

  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    anyOf.forEach((entry, index) => {
      if (isRecord(entry)) {
        walkSchema(entry, `${path}.anyOf[${index}]`, issues);
      }
    });
  }

  const definitions = schema.$defs ?? schema.definitions;
  if (isRecord(definitions)) {
    for (const [key, definition] of Object.entries(definitions)) {
      if (isRecord(definition)) {
        walkSchema(definition, `${path}.$defs.${key}`, issues);
      }
    }
  }
}

function validateObjectSchema(
  schema: Record<string, unknown>,
  path: string,
  issues: OpenAiSchemaCompatibilityIssue[],
): void {
  const properties = schema.properties;
  if (!isRecord(properties)) {
    return;
  }

  if (schema.additionalProperties !== false) {
    issues.push({
      path: `${path}.additionalProperties`,
      message: 'object schemas must set additionalProperties to false',
    });
  }

  const required = schema.required;
  if (!Array.isArray(required)) {
    issues.push({
      path: `${path}.required`,
      message: 'object schemas must mark every property as required',
    });
    return;
  }

  const requiredKeys = new Set(required.filter((key): key is string => typeof key === 'string'));
  for (const key of Object.keys(properties)) {
    if (!requiredKeys.has(key)) {
      issues.push({
        path: `${path}.required`,
        message: `property "${key}" must be required; use nullable values instead of optional fields`,
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
