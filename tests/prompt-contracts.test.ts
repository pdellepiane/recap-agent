import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { auditActualRequestContract, auditLoadedRequestInstructions, instructionContracts, schemaPathExists } from '../src/audit/prompt-contracts';
import { buildPromptInventory } from '../src/audit/prompt-inventory';
import { extractionSchema } from '../src/runtime/extraction-schemas';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { ComposeReplyRequest, ExtractRequest } from '../src/runtime/contracts';
import { deriveReplyCompilerContext } from '../src/runtime/model-request-projector';
import { OpenAiAgentRuntime } from '../src/runtime/openai-agent-runtime';
import { buildOpenAiTextSchema } from '../src/runtime/openai-structured-schema';
import { instructionModuleRegistry } from '../src/runtime/prompt-manifest';
import { PromptLoader } from '../src/runtime/prompt-loader';
import { localTurnMessageContext } from '../src/runtime/turn-message-context';

const loader = new PromptLoader(path.resolve('prompts'));
function runtime(): OpenAiAgentRuntime {
  return new OpenAiAgentRuntime({
    apiKey: 'offline-construction', replyModel: 'offline', extractorModel: 'offline',
    replyProviderLimit: 4, presentationProviderLimit: 5, providerDetailLookupLimit: 3,
    promptLoader: loader,
    providerGateway: { searchProviders: async () => { throw new Error('Offline contract audit must never call gateway'); } } as never,
  });
}
const plan = () => mergePlan(createEmptyPlan({ planId: 'contract', channel: 'whatsapp', externalUserId: '51900000888' }), {
  current_node: 'resolver_consultas_informativas',
});
const extractRequest = (): ExtractRequest => ({
  userMessage: '¿Qué información tienen?', plan: plan(),
  messageContext: localTurnMessageContext('not_configured'),
});
const replyRequest = (): ComposeReplyRequest => ({
  currentNode: 'resolver_consultas_informativas', previousNode: 'contacto_inicial',
  userMessage: '¿Qué información tienen?', plan: plan(),
  messageContext: localTurnMessageContext('not_configured'),
  extraction: extractionSchema.parse({ actionIntent: null, intentConfidence: null, ambiguity: { status: 'clear', clarificationQuestion: null, interpretations: [] }, eventType: null, vendorCategory: null, vendorCategories: [], activeNeedCategory: null, location: null, budgetSignal: null, guestRange: null, preferences: [], hardConstraints: [], assumptions: [], conversationSummary: '', pauseRequested: false, contactName: null, contactEmail: null, contactPhone: null, providerFitCriteria: { eventType: null, needCategory: null, location: null, budgetAmount: null, budgetCurrency: null, mustHave: [], shouldAvoid: [], rankingNotes: "" } }), missingFields: [], searchReady: false, providerResults: [],
  turnDecision: null, informationResults: [], toolUsage: { considered: [], inputs: [], outputs: [] },
} as unknown as ComposeReplyRequest);

describe('production prompt contracts', () => {
  it('requires explicit contracts for every production compiler module', () => {
    expect(Object.keys(instructionModuleRegistry).filter((id) => !instructionContracts[id])).toEqual([]);
  });

  it('validates actual reply serialization, module files, tools and responsibility ownership', async () => {
    const request = replyRequest();
    const spec = await runtime().buildReplyRequestSpec(request);
    const context = spec.compilerContext;
    expect(auditActualRequestContract({ spec, context, evidence: request })).toEqual([]);
    expect(await auditLoadedRequestInstructions(spec, loader)).toEqual([]);
    expect(await auditLoadedRequestInstructions({ ...spec, instructions: `${spec.instructions}\nConflicting rule` }, loader)).not.toEqual([]);
    expect(auditActualRequestContract({ spec: { ...spec, filePaths: [] }, context, evidence: request })).toContain('Emitted instruction files differ from contracted module files');
    const contracts = { ...instructionContracts, shared_invariants: { owns: ['same-owner'] }, reply_support_continuity: { owns: ['same-owner'] } };
    const duplicate = { ...spec, modules: [...spec.modules, { id: 'reply_support_continuity' as const, files: instructionModuleRegistry.reply_support_continuity.files, reason: 'mutation', dependsOn: [] }] };
    expect(auditActualRequestContract({ spec: duplicate, context, evidence: request, contracts }).some((issue) => issue.startsWith('Duplicate invariant owner'))).toBe(true);
  });

  it('rejects wrong stages, missing/renamed schema fields and enum drift on the actual extraction schema', async () => {
    const request = extractRequest();
    const spec = await runtime().buildExtractionRequestSpec(request);
    const context = spec.compilerContext;
    expect(auditActualRequestContract({ spec, context, evidence: request, outputSchema: spec.outputSchema })).toEqual([]);
    expect(await auditLoadedRequestInstructions(spec, loader)).toEqual([]);
    const schema = buildOpenAiTextSchema(spec.outputSchema, 'contract_mutation') as { properties: Record<string, unknown> };
    expect(schemaPathExists(schema, 'informationRequests')).toBe(true);
    const renamed: { properties: Record<string, unknown> } = { ...schema, properties: { ...schema.properties, retiredInformation: schema.properties.informationRequests } };
    delete renamed.properties.informationRequests;
    expect(auditActualRequestContract({ spec, context, evidence: request, serializedOutputSchema: renamed }).some((issue) => issue.includes('Unavailable output binding: extraction_information.informationRequests'))).toBe(true);
    const omitted = { ...spec, modules: spec.modules.filter((module) => module.id !== 'extraction_information') };
    expect(auditActualRequestContract({ spec: omitted, context, evidence: request, outputSchema: spec.outputSchema })).toContain('Selected modules differ from typed compiler context');
    const changedEnum = { ...schema, properties: { ...schema.properties, rsvpAction: { type: 'string', enum: ['removed'] } } };
    expect(auditActualRequestContract({ spec, context, evidence: request, serializedOutputSchema: changedEnum }).some((issue) => issue.includes('Output enum drift'))).toBe(true);
    expect(auditActualRequestContract({ spec, context: { ...context, stage: 'reply' }, evidence: request, outputSchema: spec.outputSchema }).some((issue) => issue.startsWith('Wrong stage'))).toBe(true);
  });

  it('rejects outcome-specific guidance injected without its typed evidence', async () => {
    const request = replyRequest();
    const spec = await runtime().buildReplyRequestSpec(request);
    const modules = [...spec.modules, { id: 'reply_public_event_search' as const, files: instructionModuleRegistry.reply_public_event_search.files, reason: 'mutation', dependsOn: [] }];
    expect(auditActualRequestContract({ spec: { ...spec, modules }, context: deriveReplyCompilerContext(request), evidence: request }).some((issue) => issue.includes('Inapplicable evidence outcome: reply_public_event_search.hasNoAssociatedEvent'))).toBe(true);
  });
});

describe('truthful prompt reachability', () => {
  it('classifies legacy bundles separately and attributes shared files to their actual stages', async () => {
    const inventory = await buildPromptInventory({ promptsDir: path.resolve('prompts') });
    expect(inventory.entries.find((entry) => entry.filePath === 'shared/base_system.txt')?.classification).toBe('audit_only');
    const shared = inventory.entries.find((entry) => entry.filePath === 'shared/customer_context_fields.txt');
    expect(shared?.consumers.filter((consumer) => consumer.reachability === 'production').map((consumer) => consumer.callType)).toEqual(['reply']);
    expect(inventory.entries.find((entry) => entry.filePath === 'extractors/customer_fields.txt')?.classification).toBe('production');
  });

  it('does not invent consumers for stale router or transition-policy files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-inventory-'));
    try {
      await fs.mkdir(path.join(root, 'router'), { recursive: true });
      await fs.mkdir(path.join(root, 'nodes/entrevista'), { recursive: true });
      await fs.writeFile(path.join(root, 'router/stale.txt'), 'Unwired');
      await fs.writeFile(path.join(root, 'nodes/entrevista/transition_policy.txt'), 'Unwired');
      const inventory = await buildPromptInventory({ promptsDir: root });
      expect(inventory.unmappedFiles).toEqual(['nodes/entrevista/transition_policy.txt', 'router/stale.txt']);
      expect(inventory.entries.every((entry) => entry.classification === 'orphan')).toBe(true);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
