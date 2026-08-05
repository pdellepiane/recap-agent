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
});
