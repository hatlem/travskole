// Standardinnhold for de redigerbare juridiske sidene (/vilkar, /personvern).
// Lagres som rader i Setting-tabellen når admin redigerer; inntil da vises disse
// defaultene. Innholdet er et gjennomarbeidet utgangspunkt tilpasset en
// påmeldingsløsning for kurs/leirer (også for barn) — IKKE juridisk rådgivning.
// Redigeres av admin under /admin/sider.
//
// Klient-trygg modul (ingen prisma-import) slik at den kan brukes både i
// server-render og defaults.

export interface LegalPageMeta {
  /** Setting-nøkkel der innholdet lagres */
  key: 'vilkar_content' | 'personvern_content';
  /** Offentlig URL-segment */
  slug: 'vilkar' | 'personvern';
  /** Tittel på den offentlige siden + admin */
  title: string;
  /** Kort beskrivelse (SEO + admin) */
  description: string;
  /** Lenketekst i footer */
  navLabel: string;
}

export const VILKAR_DEFAULT = `
<h2>1. Om tjenesten</h2>
<p>Disse vilkårene gjelder for bruk av påmeldingsløsningen på registrering.bjerke.no («tjenesten»), som driftes av Bjerke Travbane AS («vi», «oss»). Gjennom tjenesten kan du melde deg på – eller melde på barn til – kurs, leirer og arrangementer i regi av Bjerke Travbane og tilknyttede travskoler og aktivitetsstaller. Ved å opprette bruker eller fullføre en påmelding godtar du disse vilkårene.</p>

<h2>2. Brukerkonto</h2>
<p>For å melde på må du opprette en konto med korrekte og oppdaterte opplysninger. Du er ansvarlig for å holde påloggingsinformasjonen din hemmelig og for aktivitet som skjer på kontoen din. Kontoen er personlig. Foresatte oppretter konto på vegne av seg selv og melder på sine egne barn.</p>

<h2>3. Påmelding og bekreftelse</h2>
<p>En påmelding er bindende når den er registrert i tjenesten og bekreftet av oss. Antall plasser kan være begrenset, og påmeldinger behandles fortløpende. Vi tar forbehold om at et arrangement kan bli fulltegnet.</p>

<h2>4. Priser og betaling</h2>
<p>Prisen for hvert arrangement fremgår ved påmelding. Med mindre annet er oppgitt, skal betaling skje innen fristen som angis i bekreftelsen. Manglende betaling innen fristen kan medføre at plassen tilbys andre.</p>

<h2>5. Avbestilling og refusjon</h2>
<p>Ønsker du å avbestille, ber vi deg gi beskjed så snart som mulig til registrering@bjerke.no. Ved avbestilling i god tid før oppstart refunderes innbetalt beløp, eventuelt med fradrag for et administrasjons- eller påmeldingsgebyr. Ved avbestilling tett opp mot oppstart, eller ved manglende oppmøte, kan hele eller deler av beløpet bortfalle. Dersom et arrangement avlyses av oss, refunderes hele beløpet.</p>

<h2>6. Sikkerhet, ansvar og forsikring</h2>
<p>Hestesport regnes som risikosport, og ulykker kan skje. Bjerke Travbane AS har ingen forsikring som dekker personskade som måtte oppstå under våre kurs eller aktiviteter. Vi anbefaler derfor at alle deltakere har egen ulykkesforsikring. Deltakere og foresatte plikter å følge instruksjoner fra instruktører og gjeldende sikkerhetsregler på området. Ved å melde seg på bekrefter man å være kjent med disse forholdene.</p>

<h2>7. Foresattes ansvar</h2>
<p>For deltakere under 18 år er det den foresatte som inngår avtalen og som er ansvarlig for opplysningene som oppgis – herunder helse- og allergiopplysninger som er nødvendige for barnets sikkerhet under aktiviteten.</p>

<h2>8. Bilder og video</h2>
<p>Under arrangementer kan det bli tatt bilder og video som kan publiseres på Bjerkes nettsider og i sosiale medier, forutsatt at det er gitt samtykke til dette ved påmelding. Samtykket er frivillig og kan når som helst trekkes tilbake ved å kontakte oss.</p>

<h2>9. Endringer og avlysning fra arrangøren</h2>
<p>Vi kan måtte endre tidspunkt, innhold, instruktør eller sted, eller i unntakstilfeller avlyse et arrangement – for eksempel ved sykdom, for få påmeldte eller forhold utenfor vår kontroll. Ved vesentlige endringer eller avlysning gir vi beskjed, og innbetalt beløp refunderes dersom du ikke ønsker å delta.</p>

<h2>10. Personvern</h2>
<p>Vi behandler personopplysninger i samsvar med vår <a href="/personvern">personvernerklæring</a>.</p>

<h2>11. Endringer i vilkårene</h2>
<p>Vi kan oppdatere disse vilkårene. Den til enhver tid gjeldende versjonen er tilgjengelig på denne siden, med dato for siste oppdatering.</p>

<h2>12. Kontakt</h2>
<p>Spørsmål om vilkårene kan rettes til registrering@bjerke.no.</p>
`.trim();

export const PERSONVERN_DEFAULT = `
<h2>1. Behandlingsansvarlig</h2>
<p>Bjerke Travbane AS er behandlingsansvarlig for personopplysningene som behandles gjennom påmeldingsløsningen på registrering.bjerke.no. Henvendelser om personvern kan rettes til registrering@bjerke.no.</p>

<h2>2. Hvilke opplysninger vi behandler</h2>
<p>Avhengig av arrangementet behandler vi:</p>
<ul>
<li><strong>Om den som melder på (foresatt eller deltaker):</strong> navn, e-postadresse, telefonnummer og adresse.</li>
<li><strong>Om barnet (ved påmelding av barn):</strong> navn, fødselsdato og eventuelle allergi- og helseopplysninger som er nødvendige for barnets sikkerhet under aktiviteten.</li>
<li><strong>Påmeldingsinformasjon:</strong> hvilke kurs eller arrangementer det er meldt på, samtykker som er gitt, og kommunikasjon med oss.</li>
<li><strong>Tekniske opplysninger:</strong> opplysninger som samles via informasjonskapsler (se punkt 8).</li>
</ul>

<h2>3. Formål og behandlingsgrunnlag</h2>
<ul>
<li><strong>Administrere påmelding og gjennomføre arrangementet</strong> – behandlingsgrunnlag: oppfyllelse av avtale (personvernforordningen artikkel 6 nr. 1 bokstav b).</li>
<li><strong>Allergi- og helseopplysninger om barn</strong> – behandles for å ivareta barnets sikkerhet, basert på uttrykkelig samtykke (artikkel 6 nr. 1 bokstav a, jf. artikkel 9 nr. 2 bokstav a).</li>
<li><strong>Bilder og video</strong> – publiseres kun basert på samtykke (artikkel 6 nr. 1 bokstav a).</li>
<li><strong>Kommunikasjon (bekreftelser, påminnelser o.l.)</strong> – oppfyllelse av avtale og berettiget interesse (artikkel 6 nr. 1 bokstav b og f).</li>
<li><strong>Regnskap</strong> – rettslig forpliktelse der betaling er involvert (artikkel 6 nr. 1 bokstav c).</li>
</ul>

<h2>4. Samtykke og tilbaketrekking</h2>
<p>Der behandlingen bygger på samtykke – for eksempel bilder og video, eller helseopplysninger om barn – er samtykket frivillig og kan når som helst trekkes tilbake ved å kontakte oss. Tilbaketrekking påvirker ikke lovligheten av behandlingen som er gjort før samtykket ble trukket.</p>

<h2>5. Lagringstid</h2>
<p>Vi lagrer personopplysninger så lenge det er nødvendig for formålene over. Påmeldingsopplysninger slettes eller anonymiseres normalt innen rimelig tid etter at arrangementet er gjennomført, med mindre vi er pålagt å oppbevare dem lenger – for eksempel regnskapsmateriale, som oppbevares etter bokføringsreglene. Bilder og video publisert med samtykke fjernes ved tilbaketrekking av samtykket så langt det er praktisk mulig.</p>

<h2>6. Hvem har tilgang til opplysningene</h2>
<p>Opplysningene er tilgjengelige for autorisert personell hos Bjerke Travbane og tilknyttede travskoler og aktivitetsstaller som har behov for dem for å administrere arrangementene. Vi bruker databehandlere som leverer drift og e-posttjenester på våre vegne (blant annet hosting og utsending av e-post). Disse behandler opplysningene kun etter våre instrukser og databehandleravtaler. Vi selger ikke personopplysninger.</p>

<h2>7. Dine rettigheter</h2>
<p>Du har rett til innsyn i, retting og sletting av egne opplysninger – og opplysninger om barn du har foreldreansvar for – samt rett til begrensning, dataportabilitet og å protestere mot behandling. Du kan også trekke tilbake samtykker. For å bruke rettighetene dine, kontakt oss på registrering@bjerke.no. Du har rett til å klage til Datatilsynet dersom du mener vi behandler opplysningene dine i strid med regelverket (se <a href="https://www.datatilsynet.no" target="_blank" rel="noopener noreferrer">datatilsynet.no</a>).</p>

<h2>8. Informasjonskapsler (cookies)</h2>
<p>Tjenesten bruker nødvendige informasjonskapsler for innlogging og sikkerhet, og kan bruke analyseverktøy for å forbedre tjenesten. Du kan styre informasjonskapsler i innstillingene i nettleseren din.</p>

<h2>9. Informasjonssikkerhet</h2>
<p>Vi har tekniske og organisatoriske tiltak for å beskytte personopplysninger mot uautorisert tilgang, endring og sletting – blant annet kryptert overføring (HTTPS) og tilgangsstyring.</p>

<h2>10. Endringer i personvernerklæringen</h2>
<p>Vi kan oppdatere denne erklæringen. Den til enhver tid gjeldende versjonen ligger på denne siden, med dato for siste oppdatering.</p>

<h2>11. Kontakt</h2>
<p>Spørsmål om personvern? Kontakt oss på registrering@bjerke.no.</p>
`.trim();

export const LEGAL_PAGES: LegalPageMeta[] = [
  {
    key: 'vilkar_content',
    slug: 'vilkar',
    title: 'Vilkår',
    description: 'Vilkår for bruk av påmeldingsløsningen og deltakelse på kurs, leirer og arrangementer på Bjerke.',
    navLabel: 'Vilkår',
  },
  {
    key: 'personvern_content',
    slug: 'personvern',
    title: 'Personvern',
    description: 'Hvordan Bjerke Travbane behandler personopplysninger i påmeldingsløsningen.',
    navLabel: 'Personvern',
  },
];

export const LEGAL_DEFAULTS: Record<LegalPageMeta['key'], string> = {
  vilkar_content: VILKAR_DEFAULT,
  personvern_content: PERSONVERN_DEFAULT,
};
