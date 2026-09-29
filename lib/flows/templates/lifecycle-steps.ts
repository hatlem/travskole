/**
 * Stegene i «Kurs-livssyklus»: anker, forskyvning og standardtekst. Ren modul,
 * delt av seeden og importen av de gamle kursmalene.
 */

/** Hvilket legacy-trigger-slot (email_triggers.trigger_type) hvert steg tilsvarer. */
export type LifecycleSlot = 'reminder_before' | 'welcome_start' | 'midway' | 'after_end';

export interface LifecycleStep {
  slot: LifecycleSlot;
  anchor: 'course_start' | 'course_end' | 'course_midway';
  offsetDays: number;
  subject: string;
  bodyHtml: string;
}

const CONTACT_LINE = '<p>Spørsmål? Ta kontakt på <a href="mailto:{{kontakt_epost}}">{{kontakt_epost}}</a>.</p>';
const SIGNOFF = '<p>Med vennlig hilsen<br>Teamet hos Bjerke Ponniskole</p>';

// Kronologisk rekkefølge.
export const LIFECYCLE_STEPS: readonly LifecycleStep[] = [
  { slot: 'reminder_before', anchor: 'course_start', offsetDays: -3, subject: 'Påminnelse: {{kurs_navn}} starter snart',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>Nå er det snart klart! <strong>{{kurs_navn}}</strong> starter <strong>{{kurs_startdato}}</strong>, og vi gleder oss til å møte {{barnets_navn}}.</p><p>Husk klær etter vær, lange bukser og sko med liten hæl, så blir det både trygt og godt å være i stallen og på hesteryggen.</p>' + CONTACT_LINE + SIGNOFF },
  { slot: 'welcome_start', anchor: 'course_start', offsetDays: 0, subject: 'Velkommen til {{kurs_navn}}!',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>I dag starter <strong>{{kurs_navn}}</strong>, og vi gleder oss til å ta imot {{barnets_navn}}!</p><p><strong>Kursperiode:</strong> {{kurs_startdato}}–{{kurs_sluttdato}}</p><p><strong>Ta gjerne med:</strong></p><ul><li>Lange bukser og sko med liten hæl</li><li>Klær etter vær</li><li>Drikke og eventuelt matpakke</li></ul><p>Registrerte allergier: {{allergier}}. Gi oss beskjed hvis noe har endret seg.</p>' + CONTACT_LINE + SIGNOFF },
  { slot: 'midway', anchor: 'course_midway', offsetDays: 0, subject: 'Halvveis i {{kurs_navn}}',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>Nå er vi halvveis i <strong>{{kurs_navn}}</strong>, og {{barnets_navn}} er godt i gang!</p><p>Kurset varer fram til {{kurs_sluttdato}}. Husk fortsatt passende klær og sko til hver gang.</p><p>Har du spørsmål eller tilbakemeldinger underveis, hører vi gjerne fra deg.</p>' + CONTACT_LINE + SIGNOFF },
  { slot: 'after_end', anchor: 'course_end', offsetDays: 1, subject: 'Takk for deltakelsen på {{kurs_navn}}!',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>Tusen takk for at {{barnets_navn}} var med på <strong>{{kurs_navn}}</strong>! Vi håper det ble en fin opplevelse med mye læring og gode stunder med hestene.</p><p>Vi setter stor pris på tilbakemeldinger – svar gjerne på denne e-posten med tankene dine.</p><p>Følg med på nettsiden vår for kommende kurs og leirer. Vi håper å se {{barnets_navn}} igjen snart!</p>' + SIGNOFF },
];
