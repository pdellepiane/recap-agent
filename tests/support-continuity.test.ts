import { describe, expect, it } from 'vitest';
import { isSupportAcknowledgment, reduceSupportAnchor } from '../src/core/support-continuity';

describe('bounded user-reported support anchor', () => {
  it('preserves a mailbox report through a deferral and misspelled clarification extraction', () => {
    const report = reduceSupportAnchor(null, { kind: 'report_issue', topic: 'mailbox_capacity', detail: 'mailbox_full' });
    const deferred = reduceSupportAnchor(report, { kind: 'defer_submission', topic: 'unknown', detail: 'unknown' });
    expect(deferred).toEqual({ topic: 'mailbox_capacity', detail: 'mailbox_full', last_act: 'defer_submission', phase: 'deferred' });
    const clarified = reduceSupportAnchor(deferred, { kind: 'provide_detail', topic: 'mailbox_capacity', detail: 'mailbox_full' });
    expect(clarified.topic).toBe('mailbox_capacity');
    expect(isSupportAcknowledgment({ kind: 'defer_submission', topic: 'unknown', detail: 'unknown' })).toBe(true);
  });
  it('does not transplant details to a new support topic or treat policy questions as acknowledgments', () => {
    const previous = reduceSupportAnchor(null, { kind: 'report_issue', topic: 'mailbox_capacity', detail: 'mailbox_full' });
    expect(reduceSupportAnchor(previous, { kind: 'ask_policy', topic: 'purchase_status', detail: 'unknown' }).detail).toBe('unknown');
    expect(isSupportAcknowledgment({ kind: 'ask_policy', topic: 'purchase_status', detail: 'unknown' })).toBe(false);
    expect(reduceSupportAnchor(null, { kind: 'provide_detail', topic: 'unknown', detail: 'unknown' }).phase).toBe('needs_clarification');
  });
});
