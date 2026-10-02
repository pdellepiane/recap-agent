import { describe, expect, it } from 'vitest';

import type { NormalizedInboundMessage } from '../src/core/messages';
import type { AgentConversationMessage } from '../src/runtime/agent-conversation-gateway';
import {
  buildTurnMessageContext,
  recentConversationMessageLimit,
} from '../src/runtime/turn-message-context';
import {
  isRsvpConsentDecision,
  resolveCampaignReplyDisposition,
  resolveClassifierProfile,
  resolveContinuityDecision,
  resolveReminderContext,
} from '../src/runtime/conversation-continuity-policy';

function inbound(overrides: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    channel: 'terminal_whatsapp',
    externalUserId: 's05-user',
    text: 'Gracias',
    messageId: 'wamid-s05-current',
    receivedAt: '2026-09-04T13:11:35.000Z',
    ...overrides,
  };
}

function msg(
  id: number,
  direction: 'inbound' | 'outbound',
  source: string | null,
  body = `body-${id}`,
): AgentConversationMessage {
  return {
    id,
    direction,
    source,
    body,
    status: 'sent',
    sentAt: `2026-09-04T13:${String(10 + id).padStart(2, '0')}:00.000Z`,
    createdAt: null,
  };
}

describe('S05 conversation continuity', () => {
  it('replays Jose: respond plus acknowledgement_only never reopens the interview', () => {
    const disposition = resolveCampaignReplyDisposition({
      action: 'respond',
      campaignReplyKind: 'acknowledgement_only',
      hasExplicitRequest: false,
      hasRsvpDecision: false,
      hasCredentialDecision: false,
      isExplicitTopicSwitch: false,
    });
    expect(disposition).toBe('acknowledge_without_interview');

    const decision = resolveContinuityDecision({
      hasPriorContext: true,
      historyStatus: 'available',
      action: 'respond',
      campaignReplyKind: 'acknowledgement_only',
      extractionDeltaEmpty: true,
      hasExplicitRequest: false,
      hasRsvpDecision: false,
      hasCredentialDecision: false,
      isExplicitTopicSwitch: false,
      isPureClosure: true,
      hasSubstantiveRelationshipRemark: false,
      attendingState: 'none',
      hasActionableUnresolvedRequest: false,
    });
    expect(decision.shouldSuppressWelcome).toBe(true);
    expect(decision.allowOnboarding).toBe(false);
    expect(decision.providerToolsAllowed).toBe(false);
    expect(decision.passThrough).toBe(false);
  });

  it('suppresses a typed pure closure without tools or a new question', () => {
    const decision = resolveContinuityDecision({
      hasPriorContext: true,
      historyStatus: 'available',
      action: 'suppress_acknowledgement',
      campaignReplyKind: 'acknowledgement_only',
      extractionDeltaEmpty: true,
      hasExplicitRequest: false,
      hasRsvpDecision: false,
      hasCredentialDecision: false,
      isExplicitTopicSwitch: false,
      isPureClosure: true,
      hasSubstantiveRelationshipRemark: false,
      attendingState: 'none',
      hasActionableUnresolvedRequest: false,
    });
    expect(decision.disposition).toBe('suppress_closure');
    expect(decision.suppressPureClosure).toBe(true);
    expect(decision.acknowledgeRelationshipOnce).toBe(false);
    expect(decision.providerToolsAllowed).toBe(false);
  });

  it('acknowledges one substantive relationship comment without a question or state change', () => {
    const decision = resolveContinuityDecision({
      hasPriorContext: true,
      historyStatus: 'available',
      action: 'respond',
      campaignReplyKind: 'acknowledgement_only',
      extractionDeltaEmpty: true,
      hasExplicitRequest: false,
      hasRsvpDecision: false,
      hasCredentialDecision: false,
      isExplicitTopicSwitch: false,
      isPureClosure: false,
      hasSubstantiveRelationshipRemark: true,
      attendingState: 'attending',
      hasActionableUnresolvedRequest: false,
    });
    expect(decision.acknowledgeRelationshipOnce).toBe(true);
    expect(decision.preserveAttending).toBe(true);
    expect(decision.allowPartySizeChange).toBe(false);
    expect(decision.grantAccess).toBe(false);
    expect(decision.isRsvpConsent).toBe(false);
    expect(decision.providerToolsAllowed).toBe(false);
  });

  it('passes explicit requests, credentials, RSVP decisions and topic switches through', () => {
    for (const variant of [
      { hasExplicitRequest: true, hasRsvpDecision: false, hasCredentialDecision: false, isExplicitTopicSwitch: false },
      { hasExplicitRequest: false, hasRsvpDecision: true, hasCredentialDecision: false, isExplicitTopicSwitch: false },
      { hasExplicitRequest: false, hasRsvpDecision: false, hasCredentialDecision: true, isExplicitTopicSwitch: false },
      { hasExplicitRequest: false, hasRsvpDecision: false, hasCredentialDecision: false, isExplicitTopicSwitch: true },
    ]) {
      const decision = resolveContinuityDecision({
        hasPriorContext: true,
        historyStatus: 'available',
        action: 'suppress_acknowledgement',
        campaignReplyKind: 'acknowledgement_only',
        extractionDeltaEmpty: false,
        ...variant,
        isPureClosure: false,
        hasSubstantiveRelationshipRemark: false,
        attendingState: 'none',
        hasActionableUnresolvedRequest: false,
      });
      expect(decision.passThrough).toBe(true);
      expect(decision.disposition).toBe('extract_action');
      expect(decision.providerToolsAllowed).toBe(true);
    }
  });

  it('keeps Maria Paz confusion out of RSVP consent', () => {
    expect(
      isRsvpConsentDecision({ campaignReplyKind: 'question_or_request', hasExplicitRsvpDecision: false }),
    ).toBe(false);
    expect(
      isRsvpConsentDecision({ campaignReplyKind: 'acknowledgement_only', hasExplicitRsvpDecision: false }),
    ).toBe(false);
    expect(
      isRsvpConsentDecision({ campaignReplyKind: 'rsvp_decision', hasExplicitRsvpDecision: true }),
    ).toBe(true);
    expect(
      isRsvpConsentDecision({ campaignReplyKind: 'rsvp_decision', hasExplicitRsvpDecision: false }),
    ).toBe(false);
  });

  it('bounds missing-history clarification and never onboards', () => {
    const actionable = resolveContinuityDecision({
      hasPriorContext: false,
      historyStatus: 'unavailable',
      action: 'respond',
      campaignReplyKind: 'not_applicable',
      extractionDeltaEmpty: true,
      hasExplicitRequest: false,
      hasRsvpDecision: false,
      hasCredentialDecision: false,
      isExplicitTopicSwitch: false,
      isPureClosure: false,
      hasSubstantiveRelationshipRemark: false,
      attendingState: 'none',
      hasActionableUnresolvedRequest: true,
    });
    expect(actionable.boundedClarification).toBe(true);
    expect(actionable.allowOnboarding).toBe(false);

    const idle = resolveContinuityDecision({
      hasPriorContext: false,
      historyStatus: 'unavailable',
      action: 'respond',
      campaignReplyKind: 'not_applicable',
      extractionDeltaEmpty: true,
      hasExplicitRequest: false,
      hasRsvpDecision: false,
      hasCredentialDecision: false,
      isExplicitTopicSwitch: false,
      isPureClosure: false,
      hasSubstantiveRelationshipRemark: false,
      attendingState: 'none',
      hasActionableUnresolvedRequest: false,
    });
    expect(idle.boundedClarification).toBe(false);

    // A known-empty history likewise never starts onboarding on an
    // empty delta.
    const emptyDelta = resolveContinuityDecision({
      hasPriorContext: false,
      historyStatus: 'empty',
      action: 'respond',
      campaignReplyKind: 'not_applicable',
      extractionDeltaEmpty: true,
      hasExplicitRequest: false,
      hasRsvpDecision: false,
      hasCredentialDecision: false,
      isExplicitTopicSwitch: false,
      isPureClosure: false,
      hasSubstantiveRelationshipRemark: false,
      attendingState: 'none',
      hasActionableUnresolvedRequest: false,
    });
    expect(emptyDelta.allowOnboarding).toBe(false);
  });

  it('classifies campaign followups by recency and source, anchoring only the newest entry', () => {
    const current = [msg(1, 'outbound', 'frontend_followup'), msg(2, 'inbound', null)];
    expect(resolveClassifierProfile(current)).toBe('campaign_reply');
    expect(resolveReminderContext(current).hasCurrentReminder).toBe(true);

    const sameShapeOtherBody = [msg(1, 'outbound', 'frontend_followup', 'zzz-unrelated-body'), msg(2, 'inbound', null, 'other-words')];
    expect(resolveClassifierProfile(sameShapeOtherBody)).toBe('campaign_reply');

    const anchored = buildTurnMessageContext({
      inbound: inbound(),
      messages: [
        msg(1, 'outbound', 'admin_campaign'),
        msg(2, 'inbound', null),
        msg(3, 'outbound', 'frontend_followup'),
      ],
    });
    expect(anchored.entryMessage?.id).toBe(3);
    expect(anchored.entryMessage?.source).toBe('frontend_followup');

    const displaced = [
      msg(1, 'outbound', 'admin_campaign'),
      msg(2, 'outbound', 'agent'),
    ];
    expect(resolveClassifierProfile(displaced)).toBe('general');
    const displacedReminder = resolveReminderContext(displaced);
    expect(displacedReminder.hasReminderHistory).toBe(true);
    expect(displacedReminder.hasCurrentReminder).toBe(false);
    expect(displacedReminder.hasOldCampaignOnly).toBe(true);

    const messages = [
      msg(1, 'outbound', 'admin_campaign'),
      msg(2, 'outbound', 'agent'),
      msg(3, 'outbound', 'admin_manual'),
    ];
    // Operator rule: only CAMPAIGN-sourced reminders license the campaign
    // assumption. An agent-sent manual followup selects the general profile,
    // leaves no reminder entry, and reports no current reminder.
    expect(resolveClassifierProfile(messages)).toBe('general');
    const reminder = resolveReminderContext(messages);
    expect(reminder.hasReminderHistory).toBe(true);
    expect(reminder.hasCurrentReminder).toBe(false);
    expect(reminder.hasOldCampaignOnly).toBe(true);
    expect(reminder.hasManualFollowup).toBe(true);
    expect(reminder.entryMessageId).toBe(1);

    const context = buildTurnMessageContext({
      inbound: inbound(),
      messages,
    });
    expect(context.entryMessage?.id).toBe(1);
    expect(context.recentMessages).toHaveLength(3);
  });

  it('keeps raw history bounded with no second memory', () => {
    const messages = Array.from({ length: recentConversationMessageLimit + 3 }, (_, index) =>
      msg(index + 1, index % 2 === 0 ? 'outbound' : 'inbound', index % 2 === 0 ? 'agent' : null),
    );
    const context = buildTurnMessageContext({ inbound: inbound(), messages });
    expect(context.recentMessages).toHaveLength(recentConversationMessageLimit);
  });
});
