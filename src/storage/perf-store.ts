import type { TurnPerfRecord } from '../logs/trace/perf';

export interface PerfStore {
  saveTurn(record: TurnPerfRecord): Promise<void>;
}

export class NoopPerfStore implements PerfStore {
  async saveTurn(): Promise<void> {
    return;
  }
}
