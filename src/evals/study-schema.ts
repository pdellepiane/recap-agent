import { z } from 'zod';

import { decisionNodeSchema } from '../core/decision-nodes';

export const eventGroupSchema = z.enum([
  'wedding',
  'birthday',
  'baby_shower',
  'corporate',
  'social',
]);

export const routeFamilySchema = z.enum([
  'clarification',
  'recommendation',
  'multi_need',
  'refinement',
  'selection',
  'pause_resume',
  'closure',
  'faq',
  'no_results',
  'error_recovery',
]);

const studyScenarioSchema = z.object({
  id: z.string().regex(/^study\.[a-z0-9_]+\.[0-9]{2}$/u),
  eventGroup: eventGroupSchema,
  routeFamily: routeFamilySchema,
  description: z.string().min(1),
  inputs: z.array(z.string().min(1)).min(1),
  expectedEventType: z.string().nullable(),
  expectedNeedCategories: z.array(z.string()).default([]),
  expectedNodes: z.array(decisionNodeSchema).min(1),
  expectSearch: z.boolean(),
  expectShortlist: z.boolean(),
  expectPersistence: z.boolean(),
  expectClosure: z.boolean(),
  terminalNodes: z.array(decisionNodeSchema).min(1),
  maxTurns: z.number().int().positive(),
});

export const technicalStudyManifestSchema = z.object({
  id: z.literal('technical-evaluation-50-v1'),
  version: z.literal(1),
  frozenAt: z.string(),
  repetitions: z.literal(3),
  scenarios: z.array(studyScenarioSchema).length(50),
}).superRefine((manifest, context) => {
  const ids = new Set(manifest.scenarios.map((scenario) => scenario.id));
  if (ids.size !== manifest.scenarios.length) {
    context.addIssue({ code: 'custom', message: 'Scenario identifiers must be unique.' });
  }
  for (const group of eventGroupSchema.options) {
    const count = manifest.scenarios.filter((scenario) => scenario.eventGroup === group).length;
    if (count !== 10) {
      context.addIssue({
        code: 'custom',
        message: `Event group "${group}" must contain exactly 10 scenarios; found ${count}.`,
      });
    }
  }
});

export type StudyScenario = z.infer<typeof studyScenarioSchema>;
export type TechnicalStudyManifest = z.infer<typeof technicalStudyManifestSchema>;
