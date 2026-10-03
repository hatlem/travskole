/**
 * Pure classification of inbound mailbox messages, no IO — see
 * task-4-brief.md. This is only the classification logic: a later task
 * (the not-yet-built Task 9 Graph poller) will fetch inbound messages via
 * Microsoft Graph, extract their In-Reply-To/References headers and DSN
 * (delivery-status-notification/bounce) metadata, and call
 * classifyInboundMessage() to decide whether the message is:
 *
 *   - a reply to a tracked flow email (exit the contact's active flow
 *     enrollment with reason "svar"),
 *   - a bounce (hard/soft — may suppress the recipient), or
 *   - unrelated (ignore).
 *
 * No Graph API calls, no database access, and no other IO happen here.
 */

export interface InboundMessageLike {
  /** Raw In-Reply-To header value, e.g. "<abc123@mail.gmail.com>", or null if absent. */
  inReplyTo: string | null;
  /**
   * References header split into individual tokens (each MAY still have
   * angle brackets — this module normalizes them), e.g.
   * ["<msg1@x.com>", "<msg2@y.com>"], or [] if absent.
   */
  references: string[];
  /** Sender address. Informational only — not used in matching logic. */
  from: string | null;
  /** Informational only, not used in matching logic. */
  subject: string;
  /** True if this inbound message is a delivery-status-notification (multipart/report; report-type=delivery-status). */
  isDsn: boolean;
  /** e.g. "5.1.1" or "4.4.1" — the DSN Status field. Only meaningful when isDsn is true. */
  dsnStatus?: string;
  /** The recipient email address that failed, from the DSN, if present. */
  failedRecipient?: string | null;
  /** Raw internet headers (used to recognize auto-replies). */
  headers?: { name: string; value: string }[];
}

const AUTO_REPLY_SUBJECT = /^\s*(automatisk svar|autosvar|out of office|fraværende|automatic reply|auto-?reply)\b/i;
const AUTO_PRECEDENCE = new Set(['auto_reply', 'bulk', 'junk']);

/**
 * Fraværsmeldinger/autosvar (RFC 3834 Auto-Submitted, Exchange-/Gmail-
 * varianter og kjente emneprefikser) er ikke et ekte svar fra kontakten.
 */
export function isAutoReply(msg: Pick<InboundMessageLike, 'subject' | 'headers'>): boolean {
  if (AUTO_REPLY_SUBJECT.test(msg.subject)) return true;
  for (const { name, value } of msg.headers ?? []) {
    const key = name.trim().toLowerCase();
    const val = value.trim().toLowerCase();
    if (key === 'auto-submitted' && val !== '' && val !== 'no') return true;
    if (key === 'x-autoreply' || key === 'x-autorespond' || key === 'x-ms-exchange-inbox-rules-loop') return true;
    if (key === 'precedence' && AUTO_PRECEDENCE.has(val)) return true;
  }
  return false;
}

export type Classification =
  | { kind: 'reply'; matchedMessageId: string }
  | { kind: 'bounce'; hard: boolean; failedRecipient?: string }
  | { kind: 'ignore' };

/** Matches a single Message-ID-style token, optionally wrapped in angle brackets. */
const TOKEN_PATTERN = /<[^>]*>|\S+/g;

/**
 * Parses one or more whitespace-separated Message-ID-style tokens from a
 * raw header value, each optionally wrapped in angle brackets, and returns
 * them normalized (brackets stripped, surrounding whitespace trimmed) in
 * the order they appeared.
 *
 * Returns [] if headerValue is null, empty, or whitespace-only.
 */
export function extractMessageIds(headerValue: string | null): string[] {
  if (!headerValue) return [];

  const trimmed = headerValue.trim();
  if (trimmed === '') return [];

  const tokens = trimmed.match(TOKEN_PATTERN) ?? [];

  return tokens.map((token) => {
    const stripped = token.startsWith('<') && token.endsWith('>') ? token.slice(1, -1) : token;
    return stripped.trim();
  });
}

/**
 * Classifies an inbound mailbox message as a reply to a tracked flow
 * email, a bounce (DSN), or something to ignore.
 *
 * DSN check runs first and takes absolute priority: if msg.isDsn is true,
 * this always returns a `bounce` classification, even if the message also
 * happens to carry In-Reply-To/References headers that would otherwise
 * match a known message id.
 *
 * Auto-replies (out-of-office etc., see isAutoReply) are ignored.
 *
 * Otherwise, candidate message ids are built from In-Reply-To (first) and
 * then References (in original order), each normalized the same way as
 * extractMessageIds, and checked in that order against knownMessageIds.
 * The caller is responsible for ensuring knownMessageIds contains already-
 * normalized (bracket-free) ids.
 */
export function classifyInboundMessage(
  msg: InboundMessageLike,
  knownMessageIds: Set<string>,
): Classification {
  if (msg.isDsn) {
    const hard = msg.dsnStatus?.startsWith('5') ?? false;
    return {
      kind: 'bounce',
      hard,
      failedRecipient: msg.failedRecipient ?? undefined,
    };
  }

  if (isAutoReply(msg)) return { kind: 'ignore' };

  const candidates = [
    ...extractMessageIds(msg.inReplyTo),
    ...msg.references.flatMap((ref) => extractMessageIds(ref)),
  ];

  const matchedMessageId = candidates.find((candidate) => knownMessageIds.has(candidate));

  if (matchedMessageId !== undefined) {
    return { kind: 'reply', matchedMessageId };
  }

  return { kind: 'ignore' };
}
