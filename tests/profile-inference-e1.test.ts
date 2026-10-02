import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EvalLoader } from '../src/evals/loader';

const ledgerRowSchema = z.object({
  case: z.string().min(1),
  expectation: z.string().min(1),
  type: z.string().min(1),
  disposition: z.enum(['retain', 'revise', 'replace']),
  rationale: z.string().min(1),
});

const ledgerSchema = z.object({
  packet: z.literal('E1'),
  totalCases: z.number().int().positive(),
  totalExpectations: z.number().int().positive(),
  removed: z.array(z.object({
    case: z.string().min(1),
    expectation: z.string().min(1),
    disposition: z.enum(['retain', 'revise', 'replace']),
  })).default([]),
  added: z.array(z.object({
    case: z.string().min(1),
    expectation: z.string().min(1),
  })).default([]),
  rows: z.array(ledgerRowSchema).min(1),
});

const inventorySchema = z.object({
  count: z.number().int().positive(),
  cases: z.array(z.object({ id: z.string().min(1) })).min(1),
});

async function loadCatalog() {
  const evalDirectory = path.resolve(process.cwd(), 'evals');
  return new EvalLoader(evalDirectory).loadCatalog();
}

describe('packet E1 profile-inference expectation audit', () => {
  it('ledger covers every expectation of every inventory case with a discovered count', async () => {
    const planDirectory = path.resolve(process.cwd(), 'docs/plan/2026-09-09-lean-conversation');
    const ledger = ledgerSchema.parse(JSON.parse(
      await fs.readFile(path.join(planDirectory, 'profile-inference-disposition-ledger.json'), 'utf8'),
    ) as unknown);
    const inventory = inventorySchema.parse(JSON.parse(
      await fs.readFile(path.join(planDirectory, 'profile-inference-test-inventory-2026-09-15.json'), 'utf8'),
    ) as unknown);
    const catalog = await loadCatalog();
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));

    const inventoryIds = new Set(inventory.cases.map((entry) => entry.id));
    expect(ledger.totalCases).toBe(inventoryIds.size);
    expect(ledger.totalExpectations).toBe(ledger.rows.length + ledger.removed.length - ledger.added.length);
    expect(ledger.totalExpectations).toBe(
      [...inventoryIds].reduce(
        (sum, id) => sum + (casesById.get(id)?.expectations.length ?? 0),
        0,
      ) + ledger.removed.length - ledger.added.length,
    );

    const ledgerCases = new Set(ledger.rows.map((row) => row.case));
    expect(ledgerCases).toEqual(inventoryIds);
    for (const id of inventoryIds) {
      const live = casesById.get(id);
      expect(live, `inventory case ${id} missing from catalog`).toBeDefined();
      const ledgerIds = new Set(
        ledger.rows.filter((row) => row.case === id).map((row) => row.expectation),
      );
      const liveIds = new Set((live?.expectations ?? []).map((e) => e.id ?? `${e.type}-unnamed`));
      expect(ledgerIds).toEqual(liveIds);
    }
  });

  it('host-declining is split into unique-guest and distinguishable-identity tests', async () => {
    const catalog = await loadCatalog();
    const casesById = new Map(catalog.cases.map((evalCase) => [evalCase.id, evalCase]));
    // 2026-09-30 live compression: the unique-guest thread merged into the
    // consistent survivor as turns 3-5 with its per-turn fixture intact.
    const consistent = casesById.get('live_behavior.rsvp_host_set_declining_consistent');
    expect(consistent).toBeDefined();
    for (const turn of [0, 1, 2]) {
      expect(consistent?.inputs[turn]?.backendFixture?.scenario).toBe('rsvp-host-declining');
    }
    for (const turn of [3, 4, 5]) {
      expect(consistent?.inputs[turn]?.backendFixture?.scenario).toBe('rsvp-host-declining-unique');
    }
    expect(consistent?.backendFixture?.scenario).toBe('rsvp-host-declining');

    const evalDirectory = path.resolve(process.cwd(), 'evals/fixtures');
    const uniqueFixture = JSON.parse(
      await fs.readFile(path.join(evalDirectory, 'rsvp-host-declining-unique.json'), 'utf8'),
    ) as {
      eventDetails: Record<string, { attendance: { has_responded: boolean; will_attend: number } }>;
    };
    const uniqueEvents = Object.values(uniqueFixture.eventDetails);
    expect(uniqueEvents).toHaveLength(1);
    expect(uniqueEvents[0]?.attendance.has_responded).toBe(false);
    expect(uniqueEvents[0]?.attendance.will_attend).toBe(0);

    const splitFixture = JSON.parse(
      await fs.readFile(path.join(evalDirectory, 'rsvp-host-declining.json'), 'utf8'),
    ) as {
      eventDetails: Record<string, { event: { datetime: string }; attendance: { will_attend: number } }>;
    };
    const datetimes = new Set(Object.values(splitFixture.eventDetails).map((d) => d.event.datetime));
    expect(datetimes.size).toBe(Object.keys(splitFixture.eventDetails).length);

    const crossGuest = JSON.parse(
      await fs.readFile(path.join(evalDirectory, 'rsvp-same-event-cross-guest.json'), 'utf8'),
    ) as { scenario: string };
    expect(crossGuest.scenario).toBe('rsvp-same-event-cross-guest');
  });

});
