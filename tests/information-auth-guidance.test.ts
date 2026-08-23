import { describe, expect, it } from 'vitest';

import { createInformationAuthGuidance } from '../src/core/information';

describe('information authentication guidance', () => {
  it('requires account-access context before asking for an email', () => {
    expect(createInformationAuthGuidance('email_required', null)).toEqual({
      reason: 'email_required',
      email: null,
      requirements: ['explain_account_information_access'],
    });
  });

  it('requires complete provider-neutral delivery guidance after sending a code', () => {
    expect(
      createInformationAuthGuidance('otp_sent', 'person@example.com'),
    ).toEqual({
      reason: 'otp_sent',
      email: 'person@example.com',
      requirements: [
        'show_destination_email',
        'wait_up_to_one_minute',
        'check_main_inbox',
        'check_junk_mail',
        'explain_images_not_supported',
        'copy_and_paste_code_here',
      ],
    });
    expect(
      createInformationAuthGuidance('otp_resent', 'person@example.com'),
    ).toEqual({
      reason: 'otp_resent',
      email: 'person@example.com',
      requirements: [
        'show_destination_email',
        'wait_up_to_one_minute',
        'check_main_inbox',
        'check_junk_mail',
        'explain_images_not_supported',
        'copy_and_paste_code_here',
      ],
    });
  });

  it('requires security context and both recovery paths when a code is missing', () => {
    expect(
      createInformationAuthGuidance('otp_not_received', 'person@example.com'),
    ).toEqual({
      reason: 'otp_not_received',
      email: 'person@example.com',
      requirements: [
        'explain_account_ownership_security',
        'show_destination_email',
        'wait_up_to_one_minute',
        'check_main_inbox',
        'check_junk_mail',
        'offer_code_resend',
        'offer_email_change',
      ],
    });
  });

  it('offers recovery after one invalid code and human support after a repeated failure', () => {
    expect(
      createInformationAuthGuidance('otp_invalid', 'person@example.com'),
    ).toEqual({
      reason: 'otp_invalid',
      email: 'person@example.com',
      requirements: [
        'show_destination_email',
        'offer_code_resend',
        'offer_email_change',
      ],
    });
    expect(
      createInformationAuthGuidance(
        'otp_repeated_failure',
        'person@example.com',
      ),
    ).toEqual({
      reason: 'otp_repeated_failure',
      email: 'person@example.com',
      requirements: ['show_destination_email', 'offer_human_support'],
    });
  });

  it('keeps rate limits and outages distinct from invalid codes', () => {
    expect(createInformationAuthGuidance('otp_send_rate_limited', 'person@example.com'))
      .toEqual({
        reason: 'otp_send_rate_limited',
        email: 'person@example.com',
        requirements: ['show_destination_email', 'offer_code_resend'],
      });
    expect(createInformationAuthGuidance('otp_send_unavailable', 'person@example.com'))
      .toEqual({
        reason: 'otp_send_unavailable',
        email: 'person@example.com',
        requirements: ['show_destination_email', 'offer_human_support'],
      });
    expect(createInformationAuthGuidance('otp_verification_rate_limited', 'person@example.com'))
      .toEqual({
        reason: 'otp_verification_rate_limited',
        email: 'person@example.com',
        requirements: ['show_destination_email', 'offer_code_resend'],
      });
  });
});
