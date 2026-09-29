/**
 * Standard flytmaler — ferdige forslag uten KI. Settes inn som flyter med
 * status `template`; admin lager et utkast med «Bruk mal» og justerer derfra.
 * Kontaktflyter har bare {{forelder_navn}} (kontaktens navn) som flettefelt.
 */
import type { FlowTemplate, TemplateContext } from './builder';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const personalSignoff = (ctx: TemplateContext): string =>
  `<p>Vennlig hilsen<br>${escapeHtml(ctx.senderName)}<br>Bjerke Travbane</p>`;

const eventsLink = (ctx: TemplateContext, label: string): string =>
  `<a href="${escapeHtml(ctx.siteUrl.replace(/\/$/, ''))}/arrangementer">${label}</a>`;

export const REBOOKING_TEMPLATE: FlowTemplate = {
  name: 'Gjenbooking julebord/firmafest',
  description:
    'Personlig invitasjon til fjorårets julebord- og firmafestkunder. Meld inn et segment manuelt. Påminnelse ved manglende åpning, oppgave om å ringe når kontakten ikke svarer, og taggen «i dialog» ved svar.',
  isMarketing: true,
  anchorMode: 'contact',
  triggers: [],
  nodes: [
    { key: 'start', type: 'start', next: 'invite' },
    {
      key: 'invite',
      type: 'email',
      subject: 'Skal vi sette av en kveld på Bjerke i år også?',
      bodyHtml: (ctx) =>
        '<p>Hei {{forelder_navn}},</p>' +
        '<p>Takk for sist! Det var hyggelig å ha dere på besøk hos oss på Bjerke, og vi håper kvelden ble et godt minne for hele gjengen.</p>' +
        '<p>Nå planlegger vi årets sesong for julebord og firmafester, og de mest populære datoene går fort. Derfor vil vi gjerne gi dere som har vært her før, muligheten til å velge dato først.</p>' +
        '<p>Vi tilpasser kvelden etter ønskene deres, enten dere er en liten avdeling eller hele bedriften. ' +
        `${eventsLink(ctx, 'Se arrangementene våre her')}.</p>` +
        '<p>Svar gjerne direkte på denne e-posten med ønsket dato og omtrent hvor mange dere blir, så sender jeg et forslag.</p>' +
        personalSignoff(ctx),
      next: 'wait-7',
    },
    { key: 'wait-7', type: 'wait', days: 7, next: 'replied-1' },
    { key: 'replied-1', type: 'condition', kind: 'replied_email', ja: 'tag-dialog', nei: 'opened-1' },
    { key: 'opened-1', type: 'condition', kind: 'opened_email', ja: 'wait-3', nei: 'reminder', col: 1 },
    { key: 'wait-3', type: 'wait', days: 3, next: 'replied-2', col: 1 },
    { key: 'replied-2', type: 'condition', kind: 'replied_email', ja: 'tag-dialog', nei: 'clicked-1', col: 1 },
    { key: 'clicked-1', type: 'condition', kind: 'clicked_email', ja: 'task-clicked', nei: 'task-opened', col: 1 },
    { key: 'task-clicked', type: 'task', title: 'Ring: har sett på julebordtilbudet, men ikke svart', dueDays: 1, next: 'end', col: 1 },
    { key: 'task-opened', type: 'task', title: 'Ring: har åpnet julebordinvitasjonen, men ikke svart', dueDays: 2, next: 'end', col: 2 },
    {
      key: 'reminder',
      type: 'email',
      subject: 'Rakk du å se på datoene for årets julebord?',
      bodyHtml: (ctx) =>
        '<p>Hei {{forelder_navn}},</p>' +
        '<p>Jeg sendte deg en e-post for en ukes tid siden om årets julebord og firmafest hos oss på Bjerke. Den kan fort ha druknet i innboksen.</p>' +
        '<p>Vi har fortsatt ledige datoer, men fredagene og lørdagene før jul blir raskt booket. Er det aktuelt for dere i år? Et kort svar på denne e-posten holder, så tar jeg det derfra.</p>' +
        `<p>${eventsLink(ctx, 'Se arrangementene våre')}</p>` +
        personalSignoff(ctx),
      next: 'wait-5',
      col: 3,
    },
    { key: 'wait-5', type: 'wait', days: 5, next: 'replied-3', col: 3 },
    { key: 'replied-3', type: 'condition', kind: 'replied_email', ja: 'tag-dialog', nei: 'task-silent', col: 3 },
    { key: 'task-silent', type: 'task', title: 'Ring: ingen respons på julebordinvitasjonen', dueDays: 3, next: 'end', col: 3 },
    { key: 'tag-dialog', type: 'action', kind: 'add_tag', value: 'i dialog', next: 'task-reply' },
    { key: 'task-reply', type: 'task', title: 'Svar på henvendelsen om julebord/firmafest', dueDays: 1, next: 'end' },
    { key: 'end', type: 'end' },
  ],
};

export const INQUIRY_FOLLOW_UP_TEMPLATE: FlowTemplate = {
  name: 'Oppfølging av forespørsel',
  description:
    'Starter ved ny arrangementsforespørsel: oppgave om å svare innen én dag, en personlig takk med forventninger, og en påminnelse hvis forespørselen fortsatt er åpen etter tre dager.',
  isMarketing: false,
  anchorMode: 'contact',
  triggers: [{ eventType: 'booking.created' }],
  nodes: [
    { key: 'start', type: 'start', next: 'task-answer' },
    { key: 'task-answer', type: 'task', title: 'Svar på ny arrangementsforespørsel', dueDays: 1, next: 'wait-2h' },
    { key: 'wait-2h', type: 'wait', hours: 2, next: 'thanks' },
    {
      key: 'thanks',
      type: 'email',
      subject: 'Takk for forespørselen – dette skjer videre',
      bodyHtml: (ctx) =>
        '<p>Hei {{forelder_navn}},</p>' +
        '<p>Tusen takk for forespørselen! Vi har tatt imot den og ser på den nå.</p>' +
        '<p><strong>Dette skjer videre:</strong></p>' +
        '<ul>' +
        '<li>Du hører fra oss innen én virkedag med et forslag eller noen oppfølgingsspørsmål.</li>' +
        '<li>Vil du endre dato eller antall deltakere, eller har du spesielle ønsker, er det bare å svare på denne e-posten.</li>' +
        '<li>Arrangementet er endelig når du har fått en bekreftelse fra oss.</li>' +
        '</ul>' +
        '<p>Vi gleder oss til å lage en fin opplevelse for dere!</p>' +
        personalSignoff(ctx),
      next: 'wait-3',
    },
    { key: 'wait-3', type: 'wait', days: 3, next: 'replied' },
    { key: 'replied', type: 'condition', kind: 'replied_email', ja: 'end', nei: 'still-open' },
    { key: 'still-open', type: 'condition', kind: 'deal_status', value: 'open', ja: 'nudge', nei: 'end', col: 1 },
    {
      key: 'nudge',
      type: 'email',
      subject: 'Har du fått svarene du trenger?',
      bodyHtml: (ctx) =>
        '<p>Hei {{forelder_navn}},</p>' +
        '<p>Vi ville bare høre hvordan det går med planleggingen. Har du fått svarene du trenger fra oss, eller er det noe mer vi kan hjelpe med?</p>' +
        '<p>Svar gjerne på denne e-posten, så følger vi opp med en gang. Vil du heller ta en prat på telefon, skriv hvilket nummer og tidspunkt som passer.</p>' +
        personalSignoff(ctx),
      next: 'task-open',
      col: 1,
    },
    { key: 'task-open', type: 'task', title: 'Forespørselen er fortsatt åpen – ta kontakt', dueDays: 0, next: 'end', col: 1 },
    { key: 'end', type: 'end' },
  ],
};

export const AFTER_EVENT_TEMPLATE: FlowTemplate = {
  name: 'Etter arrangementet',
  description:
    'Takk for sist med ønske om tilbakemelding, og en invitasjon til å booke neste sesong en måned senere. Meld inn deltakerne manuelt på arrangementsdagen (arrangementer har ikke kursdatoer å forankre til).',
  isMarketing: true,
  anchorMode: 'contact',
  triggers: [],
  nodes: [
    { key: 'start', type: 'start', next: 'wait-1' },
    { key: 'wait-1', type: 'wait', days: 1, next: 'thanks' },
    {
      key: 'thanks',
      type: 'email',
      subject: 'Takk for sist!',
      bodyHtml: (ctx) =>
        '<p>Hei {{forelder_navn}},</p>' +
        '<p>Tusen takk for at dere la arrangementet til oss på Bjerke. Vi håper alle fikk en fin opplevelse!</p>' +
        '<p>Vi blir hele tiden bedre av å høre hva gjestene våre synes. Har du to minutter? Svar gjerne på denne e-posten og fortell oss:</p>' +
        '<ul><li>Hva fungerte aller best?</li><li>Er det noe vi kunne gjort annerledes?</li></ul>' +
        '<p>Vi leser alle tilbakemeldinger, både ros og ris.</p>' +
        personalSignoff(ctx),
      next: 'wait-5',
    },
    { key: 'wait-5', type: 'wait', days: 5, next: 'feedback' },
    { key: 'feedback', type: 'condition', kind: 'replied_email', ja: 'task-feedback', nei: 'wait-25' },
    { key: 'task-feedback', type: 'task', title: 'Les og følg opp tilbakemeldingen etter arrangementet', dueDays: 2, next: 'wait-25', col: 1 },
    { key: 'wait-25', type: 'wait', days: 25, next: 'rebook' },
    {
      key: 'rebook',
      type: 'email',
      subject: 'Skal vi holde av en dato til neste gang?',
      bodyHtml: (ctx) =>
        '<p>Hei {{forelder_navn}},</p>' +
        '<p>Det er en stund siden sist, og vi håper dere fortsatt har gode minner fra besøket hos oss.</p>' +
        '<p>Mange sikrer seg dato til neste sesong tidlig, særlig i de travle ukene før jul og sommer. Skal vi se på en dato for dere også?</p>' +
        `<p>${eventsLink(ctx, 'Se hva vi kan tilby')}, eller svar på denne e-posten med et par datoer som passer, så sjekker vi hva som er ledig.</p>` +
        personalSignoff(ctx),
      next: 'wait-7',
    },
    { key: 'wait-7', type: 'wait', days: 7, next: 'rebook-replied' },
    { key: 'rebook-replied', type: 'condition', kind: 'replied_email', ja: 'tag-dialog', nei: 'rebook-clicked' },
    { key: 'tag-dialog', type: 'action', kind: 'add_tag', value: 'i dialog', next: 'task-rebook' },
    { key: 'task-rebook', type: 'task', title: 'Svar på henvendelsen om nytt arrangement', dueDays: 1, next: 'end' },
    { key: 'rebook-clicked', type: 'condition', kind: 'clicked_email', ja: 'task-clicked', nei: 'end', col: 1 },
    { key: 'task-clicked', type: 'task', title: 'Ring: har sett på arrangementene etter invitasjonen', dueDays: 3, next: 'end', col: 1 },
    { key: 'end', type: 'end' },
  ],
};

export const WELCOME_TEMPLATE: FlowTemplate = {
  name: 'Velkommen ny kontakt',
  description:
    'Kort velkomst med lenke til kommende kurs og arrangementer. Starter når en kontakt samtykker til markedsføring.',
  isMarketing: true,
  anchorMode: 'contact',
  triggers: [{ eventType: 'consent.updated', filter: { marketing: true } }],
  nodes: [
    { key: 'start', type: 'start', next: 'wait-1h' },
    { key: 'wait-1h', type: 'wait', hours: 1, next: 'welcome' },
    {
      key: 'welcome',
      type: 'email',
      subject: 'Velkommen – fint å ha deg med!',
      bodyHtml: (ctx) => {
        const site = escapeHtml(ctx.siteUrl.replace(/\/$/, ''));
        return (
          '<p>Hei {{forelder_navn}},</p>' +
          '<p>Takk for at du vil høre fra oss! Fremover får du nyheter om kurs, arrangementer og det som skjer på Bjerke. Ikke for ofte, og bare når vi har noe å fortelle.</p>' +
          `<p>Nysgjerrig allerede nå? Her finner du <a href="${site}/">kommende kurs</a> og <a href="${site}/arrangementer">arrangementer for bedrifter og grupper</a>.</p>` +
          '<p>Vi sees på Bjerke!</p>' +
          '<p>Hilsen alle oss på Bjerke Travbane</p>'
        );
      },
      next: 'end',
    },
    { key: 'end', type: 'end' },
  ],
};

export const STANDARD_TEMPLATES: readonly FlowTemplate[] = [
  REBOOKING_TEMPLATE,
  INQUIRY_FOLLOW_UP_TEMPLATE,
  AFTER_EVENT_TEMPLATE,
  WELCOME_TEMPLATE,
];
