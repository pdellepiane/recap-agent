import type { InformationSupportAct, InformationSupportAnchor } from './information';

/** Stores user-reported support disposition, never verified payment or identity evidence. */
export function reduceSupportAnchor(
  previous: InformationSupportAnchor | null | undefined,
  act: InformationSupportAct,
): InformationSupportAnchor {
  const topic = act.topic === 'unknown' && previous ? previous.topic : act.topic;
  const detail = act.detail === 'unknown' && previous?.topic === topic ? previous.detail : act.detail;
  return {
    topic, detail, last_act: act.kind,
    phase: act.kind === 'defer_submission' ? 'deferred'
      : topic === 'unknown' ? 'needs_clarification' : 'active',
  };
}

export function isSupportAcknowledgment(act: InformationSupportAct | null | undefined): boolean {
  return act?.kind === 'report_issue' || act?.kind === 'provide_detail' || act?.kind === 'defer_submission';
}
