/** Takketeksten, uten databasetilgang (brukes også i nettleseren til forhåndsvisning). */

export type ThanksMode = 'off' | 'click' | 'auto';

export const MAX_THANKS_TEXT = 2_000;

/** Fornavnet vi hilser med, eller tomt når vi ikke vet det (da blir det bare «Hei!»). */
export function greetingName(fromName: string | null, contactName: string | null): string {
  for (const candidate of [fromName, contactName]) {
    const first = candidate?.trim().split(/\s+/)[0] ?? '';
    if (first && !first.includes('@') && /\p{L}/u.test(first)) return first;
  }
  return '';
}

/** Setter inn fornavnet der det står {fornavn}. Uten navn fjernes plassholderen med mellomrommet foran. */
export function renderThanks(template: string, name: string): string {
  return template.replace(/(\s?)\{fornavn\}/g, (_, space: string) => (name ? `${space}${name}` : '')).trim();
}

/** Claude mener en kort takk passer: sikker, vennlig, uten spørsmål, og verken interessert eller autosvar. */
export function thanksFits(result: { kategori: string; sikker: boolean; trenger_svar: boolean; takk_passer: boolean }): boolean {
  return result.sikker && result.takk_passer && !result.trenger_svar && result.kategori !== 'autosvar' && result.kategori !== 'interessert';
}
