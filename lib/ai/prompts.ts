// Norske prompts for redigeringsassistenten + ren parser for emneforslag.
import { MERGE_TAGS } from '@/lib/email-templates';

export function assistSystemPrompt(): string {
  const tags = MERGE_TAGS.map((t) => t.tag).join(', ');
  return `Du er en skriveassistent for markedsførings-e-post på norsk (bokmål) for Bjerke Travbane (kurs og arrangementer for barn og voksne). Svar KUN med den etterspurte teksten — ingen forklaringer, ingen anførselstegn rundt svaret. Du skal ALDRI legge til lenker, priser, datoer eller fakta som ikke finnes i originalteksten. Merge-tagger (${tags}) skal beholdes nøyaktig som de er.`;
}

export function subjectVariantsPrompt(subject: string, bodyHtml: string): string {
  return `Foreslå 3 alternative emnelinjer for denne e-posten. Én per linje, uten nummerering.\n\nNåværende emne: ${subject}\n\nE-postens innhold:\n${bodyHtml}`;
}

export function toneRewritePrompt(bodyHtml: string, tone: string): string {
  const toneMap: Record<string, string> = {
    formell: 'mer formell og profesjonell',
    vennlig: 'varmere og mer vennlig',
    kort: 'kortere og mer direkte',
  };
  return `Omskriv denne e-postkroppen (HTML) så tonen blir ${toneMap[tone] ?? tone}. Behold HTML-strukturen, alle lenker og alle merge-tagger uendret. Svar kun med den omskrevne HTML-en.\n\n${bodyHtml}`;
}

export function shortenPrompt(bodyHtml: string): string {
  return `Forkort denne e-postkroppen (HTML) — behold budskapet, HTML-strukturen, alle lenker og alle merge-tagger uendret. Svar kun med den forkortede HTML-en.\n\n${bodyHtml}`;
}

export function parseSubjectVariants(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}
