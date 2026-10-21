#!/usr/bin/env node
/**
 * Candidate lint over a CAPTURED reply.
 *
 * It reports CANDIDATE issues for the agent that is qualifying the
 * conversation to look at: a handoff announcement sitting next to an
 * unresolved-money phrase (the failure the rubric calls L1), policy terms
 * the customer should not read, internal identifiers, and more than one
 * question.
 *
 * It is a lint, not a verdict. It never decides whether a reply is good, it
 * never blocks a delivery and it never influences a runtime decision: the
 * runtime routes with typed state and model output, never with keywords.
 * The verdict is the supervising agent's, against evals/e2e-supervision/
 * language-rubric.md.
 */
import fs from 'node:fs';
import path from 'node:path';

const POLICY_TERMS = [
  'RSVP', 'email', 'chat', 'marketplace', 'delivery', 'spam', 'streaming',
  'app', 'login', 'FAQ', 'feedback', 'app', 'baby shower', 'catering',
  'screenshot', 'host', 'bartender', 'wedding planner',
];

const HANDOFF_PHRASES = [
  'se derivó', 'se derivó para revisión', 'derivación', 'revisión manual',
  'una persona', 'un asesor', 'el equipo', 'solicité', 'solicitado',
  'ya pedí', 'pasa a revisión', 'queda pendiente de revisión',
];

const UNRESOLVED_PHRASES = [
  'no puedo confirmar', 'no está confirmado', 'no aparece', 'no figura',
  'no puedo verificar', 'no se ha acreditado', 'no hay registro',
  'no se encontró', 'no encontré', 'no consta', 'no se pudo',
];

const ORDER_ID_PATTERN = /\b(?:ORD|COD|ord|cod)[-_A-Za-z0-9]{4,}\b/g;

function parseArgs(argv) {
  const args = { file: null, text: null, handoff: true, unresolved: true, policyTerms: true, orderIds: true, questions: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${token}.`);
      return argv[index];
    };
    switch (token) {
      case '--file': args.file = next(); break;
      case '--text': args.text = next(); break;
      case '--no-handoff': args.handoff = false; break;
      case '--no-unresolved': args.unresolved = false; break;
      case '--no-policy-terms': args.policyTerms = false; break;
      case '--no-order-ids': args.orderIds = false; break;
      case '--no-questions': args.questions = false; break;
      case '--help':
      case '-h':
        process.stdout.write([
          'Usage: node scripts/reply-lint.mjs --file <reply.txt> | --text "<reply>"',
          '',
          '  --no-handoff       Skip the handoff/unresolved combination check.',
          '  --no-unresolved    Skip the handoff/unresolved combination check.',
          '  --no-policy-terms  Skip the policy-term check.',
          '  --no-order-ids     Skip the internal identifier check.',
          '  --no-questions     Skip the multiple-question check.',
          '',
          'Reports CANDIDATE issues. The verdict belongs to the supervising agent.',
          '',
        ].join('\n'));
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (args.file === null && args.text === null) {
    throw new Error('--file or --text is required.');
  }
  return args;
}

function findPhrases(text, phrases) {
  const lower = text.toLowerCase();
  const found = [];
  for (const phrase of phrases) {
    if (lower.includes(phrase.toLowerCase())) found.push(phrase);
  }
  return found;
}

function countQuestions(text) {
  // Spanish wraps a question in ¿…?, so the closing mark is counted once.
  // A reply that opens a question without closing it is counted as one too.
  const closing = (text.match(/\?/g) ?? []).length;
  const opening = (text.match(/¿/g) ?? []).length;
  return Math.max(closing, opening);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args.text !== null
    ? args.text
    : fs.readFileSync(path.resolve(args.file), 'utf8');
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    console.log('Reply is empty (a suppression is legitimate: record it with its reason).');
    return;
  }

  const candidates = [];

  if (args.handoff && args.unresolved) {
    const handoff = findPhrases(trimmed, HANDOFF_PHRASES);
    const unresolved = findPhrases(trimmed, UNRESOLVED_PHRASES);
    if (handoff.length > 0 && unresolved.length > 0) {
      candidates.push({
        check: 'L1 candidate',
        detail: `a handoff statement (${handoff.join(', ')}) sits next to an unresolved-money phrase (${unresolved.join(', ')})`,
        harm: 'the customer may end with two incompatible readings of her own case',
      });
    }
  }

  if (args.policyTerms) {
    const terms = findPhrases(trimmed, POLICY_TERMS);
    if (terms.length > 0) {
      candidates.push({
        check: 'L5 candidate',
        detail: `policy terms present: ${terms.join(', ')}`,
        harm: 'internal or product vocabulary the customer should not read',
      });
    }
  }

  if (args.orderIds) {
    const ids = trimmed.match(ORDER_ID_PATTERN) ?? [];
    if (ids.length > 0) {
      candidates.push({
        check: 'L5 candidate',
        detail: `internal identifiers present: ${[...new Set(ids)].join(', ')}`,
        harm: 'an order reference the customer may not have (check whether this product shows order numbers to customers)',
      });
    }
  }

  if (args.questions) {
    const questions = countQuestions(trimmed);
    if (questions > 1) {
      candidates.push({
        check: 'L8 candidate',
        detail: `${questions} question marks in one reply`,
        harm: 'the customer is asked several things and answers none of them',
      });
    }
  }

  if (candidates.length === 0) {
    console.log('No candidate issues found. Apply the rubric yourself before concluding.');
    return;
  }
  console.log('Candidate issues (the rubric still decides):');
  for (const candidate of candidates) {
    console.log(`  [${candidate.check}] ${candidate.detail}`);
    console.log(`      harm: ${candidate.harm}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
