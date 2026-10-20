/**
 * WP2 — Decisions API router: the four fixed questions.
 *
 * Decision 1 fixes the question set exactly: two predicates, one choice with
 * seven routes and one score with five ordered levels. This module owns the
 * SHAPE (names, types, route values, level labels and order); the instruction
 * text and the rubric live in git-tracked prompt files under `prompts/router/`
 * and are supplied by the PromptLoader.
 *
 * Nothing here is a conversational reply: the router decides, the reply model
 * writes. The instructions never name a reply, a promise or a wording.
 */
import type { PromptLoader } from './prompt-loader';

/** The seven routes fixed by Decision 1. Order is the contract order. */
export const routerRouteValues = [
  'answer_with_records',
  'ask_clarification',
  'offer_human',
  'escalate_human',
  'rsvp_flow',
  'planning_flow',
  'suppress_ack',
] as const;

export type RouterRoute = (typeof routerRouteValues)[number];

export function isRouterRoute(value: string): value is RouterRoute {
  return (routerRouteValues as readonly string[]).includes(value);
}

/** The five rubric levels fixed by Decision 1. Labels start at 0. */
export const routerLoopRiskLabels = ['0', '1', '2', '3', '4'] as const;

export type RouterLoopRiskLabel = (typeof routerLoopRiskLabels)[number];

export type RouterPredicateQuestionName = 'needs_human_now' | 'capability_blocked';

export type RouterPredicateQuestion = {
  readonly type: 'predicate';
  readonly name: RouterPredicateQuestionName;
  readonly instructions: string;
};

export type RouterChoiceQuestion = {
  readonly type: 'choice';
  readonly name: 'route';
  readonly instructions: string;
  readonly choices: readonly {
    readonly value: RouterRoute;
    readonly description: string;
  }[];
};

export type RouterScoreQuestion = {
  readonly type: 'score';
  readonly name: 'loop_risk';
  readonly instructions: string;
  readonly levels: readonly {
    readonly label: RouterLoopRiskLabel;
    readonly description: string;
  }[];
};

export type RouterQuestion =
  | RouterPredicateQuestion
  | RouterChoiceQuestion
  | RouterScoreQuestion;

export type RouterQuestionName =
  | RouterPredicateQuestionName
  | 'route'
  | 'loop_risk';

export type RouterQuestions = {
  readonly questions: readonly RouterQuestion[];
  readonly promptBundleId: string;
  readonly promptFilePaths: readonly string[];
};

/** Prompt files backing the four questions. Tracked under `prompts/router/`. */
export const routerQuestionPromptFiles = {
  needsHumanNow: 'router/needs_human_now.txt',
  capabilityBlocked: 'router/capability_blocked.txt',
  route: 'router/route.txt',
  loopRisk: 'router/loop_risk.txt',
} as const;

const ROUTE_SECTION_MARKER = '--- choices ---';
const LEVEL_SECTION_MARKER = '--- levels ---';

/**
 * Load the four questions with their prompt-backed instructions.
 *
 * The loader validates the prompt files against the fixed shape: seven route
 * choices in contract order, five rubric levels labelled 0..4, and distinct
 * descriptions. A prompt file that drifts from the contract fails closed
 * instead of silently changing the router.
 */
export async function loadRouterQuestions(loader: PromptLoader): Promise<RouterQuestions> {
  const paths = [
    routerQuestionPromptFiles.needsHumanNow,
    routerQuestionPromptFiles.capabilityBlocked,
    routerQuestionPromptFiles.route,
    routerQuestionPromptFiles.loopRisk,
  ];
  const loaded = await Promise.all(
    paths.map(async (relativePath) => ({
      relativePath,
      content: await loadRouterPromptFile(loader, relativePath),
    })),
  );
  const byPath = new Map(loaded.map((entry) => [entry.relativePath, entry.content]));

  const needsHumanNow = requireSection(
    byPath.get(routerQuestionPromptFiles.needsHumanNow) ?? '',
    routerQuestionPromptFiles.needsHumanNow,
  );
  const capabilityBlocked = requireSection(
    byPath.get(routerQuestionPromptFiles.capabilityBlocked) ?? '',
    routerQuestionPromptFiles.capabilityBlocked,
  );
  const routeFile = splitRouterPrompt(
    byPath.get(routerQuestionPromptFiles.route) ?? '',
    ROUTE_SECTION_MARKER,
    routerQuestionPromptFiles.route,
  );
  const loopRiskFile = splitRouterPrompt(
    byPath.get(routerQuestionPromptFiles.loopRisk) ?? '',
    LEVEL_SECTION_MARKER,
    routerQuestionPromptFiles.loopRisk,
  );

  const questions: readonly RouterQuestion[] = [
    { type: 'predicate', name: 'needs_human_now', instructions: needsHumanNow },
    { type: 'predicate', name: 'capability_blocked', instructions: capabilityBlocked },
    {
      type: 'choice',
      name: 'route',
      instructions: routeFile.instruction,
      choices: parseRouteChoices(routeFile.entries),
    },
    {
      type: 'score',
      name: 'loop_risk',
      instructions: loopRiskFile.instruction,
      levels: parseLoopRiskLevels(loopRiskFile.entries),
    },
  ];

  return {
    questions,
    promptBundleId: loaded.map((entry) => entry.relativePath).join(','),
    promptFilePaths: paths,
  };
}

/**
 * Read one tracked prompt file through the loader. `loadModuleFilesBundle`
 * prefixes each file with its display path; the prefix is stripped so the
 * caller receives the file body.
 */
async function loadRouterPromptFile(
  loader: PromptLoader,
  relativePath: string,
): Promise<string> {
  const bundle = await loader.loadModuleFilesBundle([relativePath], []);
  const header = `## ${relativePath}\n`;
  return bundle.instructions.startsWith(header)
    ? bundle.instructions.slice(header.length).trim()
    : bundle.instructions.trim();
}

function requireSection(content: string, relativePath: string): string {
  const instruction = content.trim();
  if (instruction.length === 0) {
    throw new Error(`Router prompt file is empty: ${relativePath}`);
  }
  return instruction;
}

function splitRouterPrompt(
  content: string,
  marker: string,
  relativePath: string,
): { instruction: string; entries: string[] } {
  const lines = content.split(/\r?\n/u);
  const markerIndex = lines.findIndex((line) => line.trim() === marker);
  if (markerIndex < 0) {
    throw new Error(`Router prompt file is missing the section marker "${marker}": ${relativePath}`);
  }
  const instruction = lines.slice(0, markerIndex).join('\n').trim();
  if (instruction.length === 0) {
    throw new Error(`Router prompt file has no instruction text: ${relativePath}`);
  }
  const entries = lines
    .slice(markerIndex + 1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return { instruction, entries };
}

function parseRouteChoices(
  entries: readonly string[],
): readonly { value: RouterRoute; description: string }[] {
  if (entries.length !== routerRouteValues.length) {
    throw new Error(
      `Router route prompt must define exactly ${routerRouteValues.length} choices, found ${entries.length}.`,
    );
  }
  const choices = entries.map((entry, index) => {
    const { value, description } = parseEntry(entry, routerQuestionPromptFiles.route);
    if (!isRouterRoute(value)) {
      throw new Error(`Router route prompt defines an unknown route: ${value}`);
    }
    if (value !== routerRouteValues[index]) {
      throw new Error(
        `Router route prompt must list "${routerRouteValues[index]}" at position ${index}, found "${value}".`,
      );
    }
    return { value, description };
  });
  const descriptions = new Set(choices.map((choice) => choice.description));
  if (descriptions.size !== choices.length) {
    throw new Error('Router route prompt must give every choice a distinct description.');
  }
  return choices;
}

function parseLoopRiskLevels(
  entries: readonly string[],
): readonly { label: RouterLoopRiskLabel; description: string }[] {
  if (entries.length !== routerLoopRiskLabels.length) {
    throw new Error(
      `Router loop risk prompt must define exactly ${routerLoopRiskLabels.length} levels, found ${entries.length}.`,
    );
  }
  const levels = entries.map((entry, index) => {
    const { value, description } = parseEntry(entry, routerQuestionPromptFiles.loopRisk);
    const expected = routerLoopRiskLabels[index];
    if (value !== expected) {
      throw new Error(
        `Router loop risk prompt must list level "${expected}" at position ${index}, found "${value}".`,
      );
    }
    return { label: expected, description };
  });
  const descriptions = new Set(levels.map((level) => level.description));
  if (descriptions.size !== levels.length) {
    throw new Error('Router loop risk prompt must give every level a distinct description.');
  }
  return levels;
}

function parseEntry(entry: string, relativePath: string): { value: string; description: string } {
  const separatorIndex = entry.indexOf('|');
  if (separatorIndex < 0) {
    throw new Error(`Router prompt entry must be "value | description": ${relativePath}`);
  }
  const value = entry.slice(0, separatorIndex).trim();
  const description = entry.slice(separatorIndex + 1).trim();
  if (value.length === 0 || description.length === 0) {
    throw new Error(`Router prompt entry must have a value and a description: ${relativePath}`);
  }
  return { value, description };
}
