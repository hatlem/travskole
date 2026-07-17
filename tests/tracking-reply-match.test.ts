import { describe, it, expect } from 'vitest';
import { extractMessageIds, classifyInboundMessage } from '@/lib/tracking/reply-match';
import type { InboundMessageLike } from '@/lib/tracking/reply-match';

/**
 * Pure classification logic for inbound mailbox messages. No Graph API
 * calls, no database, no IO — see task-4-brief.md. Consumed later by the
 * Task 9 Graph poller, which will fetch In-Reply-To/References headers and
 * DSN metadata and hand them to classifyInboundMessage() to decide whether
 * an inbound message is a reply (exit flow enrollment with reason "svar"),
 * a bounce (suppress recipient), or an unrelated message to ignore.
 */

function baseMsg(overrides: Partial<InboundMessageLike>): InboundMessageLike {
  return {
    inReplyTo: null,
    references: [],
    from: null,
    subject: '',
    isDsn: false,
    ...overrides,
  };
}

describe('extractMessageIds', () => {
  it('parses a multi-token header into an array in order', () => {
    expect(extractMessageIds('<a@x.com> <b@y.com>')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('parses a single bracketed token', () => {
    expect(extractMessageIds('<a@x.com>')).toEqual(['a@x.com']);
  });

  it('parses a bare unbracketed token', () => {
    expect(extractMessageIds('abc123@mail.gmail.com')).toEqual(['abc123@mail.gmail.com']);
  });

  it('returns [] for null', () => {
    expect(extractMessageIds(null)).toEqual([]);
  });

  it('returns [] for an empty string', () => {
    expect(extractMessageIds('')).toEqual([]);
  });

  it('returns [] for a whitespace-only string', () => {
    expect(extractMessageIds('   ')).toEqual([]);
  });
});

describe('classifyInboundMessage', () => {
  it('matches a Gmail-style reply via In-Reply-To', () => {
    const msg = baseMsg({
      inReplyTo: '<CAOb8f7ZqK9mF3xJ2vL8n@mail.gmail.com>',
      references: ['<CAOb8f7ZqK9mF3xJ2vL8n@mail.gmail.com>'],
      from: 'foreldre@example.com',
      subject: 'Re: Velkommen til svømmekurs',
      isDsn: false,
    });
    const known = new Set(['CAOb8f7ZqK9mF3xJ2vL8n@mail.gmail.com']);

    expect(classifyInboundMessage(msg, known)).toEqual({
      kind: 'reply',
      matchedMessageId: 'CAOb8f7ZqK9mF3xJ2vL8n@mail.gmail.com',
    });
  });

  it('matches an Outlook-style reply via References only, skipping a non-matching earlier reference', () => {
    const msg = baseMsg({
      inReplyTo: null, // Outlook sometimes omits In-Reply-To on forwarded reply chains
      references: ['<olderMsg@outlook.com>', '<original123@registrering.bjerke.no>'],
      from: 'forelder@outlook.com',
      subject: 'RE: Bekreftelse på påmelding',
      isDsn: false,
    });
    const known = new Set(['original123@registrering.bjerke.no']);

    expect(classifyInboundMessage(msg, known)).toEqual({
      kind: 'reply',
      matchedMessageId: 'original123@registrering.bjerke.no',
    });
  });

  it('ignores an unrelated inbound message whose headers do not match any known id', () => {
    const msg = baseMsg({
      inReplyTo: '<someRandomThread@external.com>',
      references: ['<someRandomThread@external.com>'],
      from: 'noreply@external.com',
      subject: 'Nyhetsbrev',
      isDsn: false,
    });
    const known = new Set(['CAOb8f7ZqK9mF3xJ2vL8n@mail.gmail.com']);

    expect(classifyInboundMessage(msg, known)).toEqual({ kind: 'ignore' });
  });

  it('classifies a hard DSN bounce (5.1.1) with a failed recipient', () => {
    const msg = baseMsg({
      isDsn: true,
      dsnStatus: '5.1.1',
      failedRecipient: 'ikke-finnes@example.com',
      subject: 'Undeliverable: Velkommen til svømmekurs',
    });
    const known = new Set<string>();

    expect(classifyInboundMessage(msg, known)).toEqual({
      kind: 'bounce',
      hard: true,
      failedRecipient: 'ikke-finnes@example.com',
    });
  });

  it('classifies a soft DSN bounce (4.4.1)', () => {
    const msg = baseMsg({
      isDsn: true,
      dsnStatus: '4.4.1',
      failedRecipient: 'midlertidig-full@example.com',
      subject: 'Delay in delivery',
    });
    const known = new Set<string>();

    expect(classifyInboundMessage(msg, known)).toEqual({
      kind: 'bounce',
      hard: false,
      failedRecipient: 'midlertidig-full@example.com',
    });
  });

  it('treats a DSN with no confident status as a soft bounce, never silently ignored', () => {
    const msg = baseMsg({
      isDsn: true,
      dsnStatus: undefined,
      failedRecipient: 'ukjent-status@example.com',
      subject: 'Mail delivery failed',
    });
    const known = new Set<string>();

    expect(classifyInboundMessage(msg, known)).toEqual({
      kind: 'bounce',
      hard: false,
      failedRecipient: 'ukjent-status@example.com',
    });
  });

  it('returns undefined (not null) for failedRecipient when the DSN has no recipient', () => {
    const msg = baseMsg({
      isDsn: true,
      dsnStatus: '5.1.1',
      failedRecipient: null,
      subject: 'Undeliverable',
    });
    const known = new Set<string>();

    const result = classifyInboundMessage(msg, known);
    expect(result).toEqual({ kind: 'bounce', hard: true, failedRecipient: undefined });
    expect((result as { failedRecipient?: string }).failedRecipient).toBeUndefined();
    expect('failedRecipient' in result).toBe(true);
  });

  it('normalizes angle brackets and whitespace so bracketed and bare forms match the same known id', () => {
    const known = new Set(['normal@x.com']);

    const bracketed = baseMsg({
      inReplyTo: '<normal@x.com>',
      references: [],
      isDsn: false,
    });
    const bare = baseMsg({
      inReplyTo: 'normal@x.com',
      references: [],
      isDsn: false,
    });

    expect(classifyInboundMessage(bracketed, known)).toEqual({
      kind: 'reply',
      matchedMessageId: 'normal@x.com',
    });
    expect(classifyInboundMessage(bare, known)).toEqual({
      kind: 'reply',
      matchedMessageId: 'normal@x.com',
    });
  });

  it('normalizes extra whitespace inside and around angle brackets', () => {
    const known = new Set(['weirdSpacing@x.com']);
    const msg = baseMsg({
      inReplyTo: '  <  weirdSpacing@x.com  >  ',
      references: [],
      isDsn: false,
    });

    expect(classifyInboundMessage(msg, known)).toEqual({
      kind: 'reply',
      matchedMessageId: 'weirdSpacing@x.com',
    });
  });

  it('prioritizes DSN classification over reply-matching even if reply headers would otherwise match', () => {
    const msg = baseMsg({
      isDsn: true,
      dsnStatus: '5.1.1',
      failedRecipient: 'ikke-finnes@example.com',
      inReplyTo: '<CAOb8f7ZqK9mF3xJ2vL8n@mail.gmail.com>',
      references: ['<CAOb8f7ZqK9mF3xJ2vL8n@mail.gmail.com>'],
    });
    const known = new Set(['CAOb8f7ZqK9mF3xJ2vL8n@mail.gmail.com']);

    expect(classifyInboundMessage(msg, known)).toEqual({
      kind: 'bounce',
      hard: true,
      failedRecipient: 'ikke-finnes@example.com',
    });
  });
});
