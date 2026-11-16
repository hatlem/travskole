/** Svar i CRM: rydding av innkommende tekst, emne, HTML og tråd-headere. */
import { describe, it, expect } from 'vitest';
import { cleanReplyText, replyBodyHtml, replySubject, textToParagraphs, threadHeaders } from '@/lib/replies/text';
import { answerTextFromHtml } from '@/lib/replies/list';

describe('cleanReplyText', () => {
  it('kutter sitert historikk fra Outlook, Gmail og norske programmer', () => {
    expect(cleanReplyText('Hei!\r\nVi er 12 stk.\r\n\r\nFra: Hilde Apneseth <hilde@bjerke.no>\r\nSendt: mandag')).toBe('Hei!\nVi er 12 stk.');
    expect(cleanReplyText('Takk\n\nOn Mon, 16 Nov 2026 at 14:45, Hilde wrote:\n> Hei')).toBe('Takk');
    expect(cleanReplyText('Ja takk\n\nDen 16. november 2026 kl. 14:45 skrev Hilde Apneseth <hilde@bjerke.no>:\n> tekst')).toBe('Ja takk');
    expect(cleanReplyText('Linje\n> sitat\nmer')).toBe('Linje\nmer');
  });
  it('rydder mellomrom og tomme linjer', () => {
    expect(cleanReplyText('  a b  \n\n\n\nc  ')).toBe('a b\n\nc');
  });
});

describe('replySubject', () => {
  it('legger til Re: én gang', () => {
    expect(replySubject('Julebord på Bjerke')).toBe('Re: Julebord på Bjerke');
    expect(replySubject('SV: Julebord')).toBe('SV: Julebord');
    expect(replySubject('re: x')).toBe('re: x');
    expect(replySubject('  ')).toBe('Re: Svar');
  });
});

describe('textToParagraphs / replyBodyHtml', () => {
  it('escaper og lager avsnitt', () => {
    expect(textToParagraphs('Hei <Ola>\nlinje 2\n\nAvsnitt 2')).toBe('<p>Hei &lt;Ola&gt;<br>linje 2</p><p>Avsnitt 2</p>');
  });
  it('siterer svaret under, og vår egen tekst kan leses tilbake', () => {
    const html = replyBodyHtml('Hei Ivar,\n\nFlott! & velkommen', {
      fromName: 'Ivar Qvist', fromEmail: 'iq@fondsfinans.no', receivedAt: new Date('2026-11-16T14:45:00Z'), bodyText: 'Vi kommer <3',
    });
    expect(html).toContain('skrev Ivar Qvist &lt;iq@fondsfinans.no&gt;:');
    expect(html).toContain('<blockquote');
    expect(html).toContain('Vi kommer &lt;3');
    expect(answerTextFromHtml(`<html><body style="x"><div>${html}</div></body></html>`)).toBe('Hei Ivar,\n\nFlott! & velkommen');
  });
});

describe('threadHeaders', () => {
  it('svarer i samme tråd', () => {
    expect(threadHeaders('abc@x.no', '<root@bjerke.no>')).toEqual({ 'In-Reply-To': '<abc@x.no>', References: '<root@bjerke.no> <abc@x.no>' });
    expect(threadHeaders('<abc@x.no>', '<root@bjerke.no> <abc@x.no>')).toEqual({ 'In-Reply-To': '<abc@x.no>', References: '<root@bjerke.no> <abc@x.no>' });
    expect(threadHeaders(null, 'x')).toEqual({});
  });
});
