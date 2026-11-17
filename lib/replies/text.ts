/** Rene hjelpere for svar i CRM: rydde innkommende tekst, lage emne, HTML og tråd-headere for vårt svar. */

const MAX_BODY = 20_000;

/** Linjer som starter sitert historikk i vanlige e-postprogrammer. */
const QUOTE_START = [
  /^On .+ wrote:\s*$/i,
  /^Den .+ skrev .+:\s*$/i,
  /^.+ skrev følgende:\s*$/i,
  /^-{2,}\s*(Original Message|Opprinnelig melding|Videresendt melding)\s*-{2,}/i,
  /^_{10,}\s*$/,
  /^(From|Fra):\s.+/i,
];

/** Varsler e-postprogrammet legger inn i teksten. */
const NOISE = /^(you don't often get email from|du mottar ikke ofte e-post fra|du får ikke ofte e-post fra)/i;

/**
 * Det nye i et svar, som ren tekst. Graph gir oftest bare det nye (uniqueBody); ellers kuttes sitert historikk
 * (linjer som «Den … skrev:», «From:» eller «>»-sitater) bort.
 */
export function cleanReplyText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (QUOTE_START.some((re) => re.test(trimmed))) break;
    if (trimmed.startsWith('>') || NOISE.test(trimmed)) continue;
    kept.push(line.replace(/\s+$/, ''));
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY);
}

export function replySubject(subject: string): string {
  const s = subject.trim() || 'Svar';
  return /^(re|sv|aw|vs)\s*:/i.test(s) ? s : `Re: ${s}`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Avsnitt fra ren tekst: tom linje = nytt avsnitt, linjeskift = <br>. */
export function textToParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const quoteDate = (d: Date) =>
  d.toLocaleString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

/** Vårt svar: teksten vi skrev, og svaret vi svarer på sitert under (som i et vanlig e-postprogram). */
export function replyBodyHtml(text: string, quoted: { fromName: string | null; fromEmail: string; receivedAt: Date; bodyText: string }): string {
  const who = quoted.fromName ? `${escapeHtml(quoted.fromName)} &lt;${escapeHtml(quoted.fromEmail)}&gt;` : escapeHtml(quoted.fromEmail);
  return (
    textToParagraphs(text) +
    `<p style="margin-top:24px;color:#666666">Den ${quoteDate(quoted.receivedAt)} skrev ${who}:</p>` +
    `<blockquote style="margin:0 0 0 4px;padding-left:12px;border-left:2px solid #cccccc;color:#555555">${textToParagraphs(quoted.bodyText)}</blockquote>`
  );
}

const bracket = (id: string) => (id.startsWith('<') ? id : `<${id}>`);

/** In-Reply-To og References, så svaret havner i samme tråd hos mottakeren. */
export function threadHeaders(internetMessageId: string | null, references: string | null): Record<string, string> {
  if (!internetMessageId) return {};
  const id = bracket(internetMessageId.trim());
  const refs = (references ?? '').split(/\s+/).filter(Boolean).map(bracket).filter((r) => r !== id);
  return { 'In-Reply-To': id, References: [...refs, id].join(' ') };
}
