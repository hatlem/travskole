import { describe, it, expect } from 'vitest';
import { parseDsnFields } from '@/lib/tracking/poller';

/**
 * Pure RFC 3464 DSN field extraction, hardened against real-world MTA
 * variants (missing type-prefix, angle brackets, casing, missing
 * whitespace, Original-Recipient-only DSNs, trailing comments, etc). See
 * task-9-brief.md follow-up: "RFC 3464-felt kan mangle for enkelte
 * MTA-varianter".
 */

describe('parseDsnFields', () => {
  it('parses standard Status + Final-Recipient with rfc822 prefix', () => {
    const body = 'Status: 5.1.1\nFinal-Recipient: rfc822; user@example.com';
    expect(parseDsnFields(body)).toEqual({
      dsnStatus: '5.1.1',
      failedRecipient: 'user@example.com',
    });
  });

  it('handles Final-Recipient with no address-type prefix', () => {
    const body = 'Final-Recipient: user@example.com';
    expect(parseDsnFields(body).failedRecipient).toBe('user@example.com');
  });

  it('strips angle brackets and lowercases the address', () => {
    const body = 'Final-Recipient: rfc822; <User@Example.com>';
    expect(parseDsnFields(body).failedRecipient).toBe('user@example.com');
  });

  it('handles no space after the address-type semicolon', () => {
    const body = 'Final-Recipient: rfc822;user@example.com';
    expect(parseDsnFields(body).failedRecipient).toBe('user@example.com');
  });

  it('falls back to Original-Recipient when Final-Recipient is absent', () => {
    const body = 'Original-Recipient: rfc822; user@example.com';
    expect(parseDsnFields(body).failedRecipient).toBe('user@example.com');
  });

  it('prefers Final-Recipient over Original-Recipient when both are present', () => {
    const body = 'Original-Recipient: rfc822; b@x.no\nFinal-Recipient: rfc822; a@x.no';
    expect(parseDsnFields(body).failedRecipient).toBe('a@x.no');
  });

  it('handles uppercase header name and mixed-case address', () => {
    const body = 'FINAL-RECIPIENT: RFC822; User@Example.COM';
    expect(parseDsnFields(body).failedRecipient).toBe('user@example.com');
  });

  it('returns undefined dsnStatus when only Final-Recipient is present', () => {
    const body = 'Final-Recipient: rfc822; user@example.com';
    const result = parseDsnFields(body);
    expect(result.dsnStatus).toBeUndefined();
    expect(result.failedRecipient).toBe('user@example.com');
  });

  it('parses a soft-bounce status code', () => {
    const body = 'Status: 4.2.2\nFinal-Recipient: rfc822; user@example.com';
    expect(parseDsnFields(body).dsnStatus).toBe('4.2.2');
  });

  it('takes the first token when trailing junk/comments follow the address', () => {
    const body = 'Final-Recipient: rfc822; user@example.com (comment)';
    expect(parseDsnFields(body).failedRecipient).toBe('user@example.com');
  });

  it('returns undefined status and null recipient for garbage/empty body', () => {
    expect(parseDsnFields('')).toEqual({ dsnStatus: undefined, failedRecipient: null });
    expect(parseDsnFields('this is not a DSN at all\njust some text')).toEqual({
      dsnStatus: undefined,
      failedRecipient: null,
    });
  });

  it('returns null recipient for a malformed address without @', () => {
    const body = 'Final-Recipient: rfc822; not-an-email';
    expect(parseDsnFields(body).failedRecipient).toBeNull();
  });
});
