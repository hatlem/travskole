# Bestilling: Graph-tilgang for e-postsporing (svar/bounce)

## Formål

Bjerke-appen trenger programmatisk (ikke menneskelig) tilgang til å lese svar
og leveringsstatus (bounces) i de delte postboksene, for å automatisk stoppe
e-postflyter når noen svarer og for å markere ugyldige adresser. Siden
Exchange Online har avviklet klassisk IMAP-basic-auth, er riktig vei en
Microsoft Graph-appregistrering.

## Konkret bestilling

Vi trenger en Entra (Azure AD) app-registrering med:

- **Application permission `Mail.Read`** (IKKE delegated — appen kjører uten
  en innlogget bruker, som en bakgrunnsjobb).
- **Admin-samtykke** (admin consent) gitt for denne permission.
- En **`ApplicationAccessPolicy`** (via Exchange Online PowerShell,
  `New-ApplicationAccessPolicy`) som scoper appens `Mail.Read`-tilgang til
  KUN fellespostboksen `registrering@bjerke.no` — ikke hele organisasjonens
  postbokser (minste-privilegium). Appen setter Reply-To på alle automatiske
  utsendelser til denne postboksen (uansett avsenderidentitet), så svar og
  leveringsfeilmeldinger lander kun der.
- Levering av `tenant ID`, `client ID` og `client secret` (eller et
  sertifikat, om det foretrekkes) via en sikker/hemmelig kanal (ikke e-post i
  klartekst). Appen setter selv miljøvariabelen `GRAPH_MAILBOXES`
  (= `registrering@bjerke.no`), så du trenger ikke oppgi den — kun de tre
  hemmelighetene over.

## Postboksen som skal scopes

- registrering@bjerke.no (kun denne — redusert fra 7 etter DNT/Basefarms
  minste-privilegium-innspill 2026-08-19; Reply-To sentraliseres i appen)

## Hvorfor Mail.Read og ikke Mail.ReadBasic

Vi trenger ikke menneskelig meldingsinnhold, men `Mail.ReadBasic` ekskluderer
også `internetMessageHeaders` (In-Reply-To/References — selve svar-matchingen)
og vedlegg (den maskinlesbare `message/delivery-status`-delen i
leveringsfeilmeldinger, RFC 3464). Graph har ikke et nivå mellom ReadBasic og
Read som dekker disse, derfor Mail.Read — kompensert med én-postboks-scoping.

## Hva lagres

Ingen meldingstekst, emner, vedlegg eller avsenderinnhold lagres. Kun:
tidsstempel «svart»/«bounce» på vår egen utsendte melding, og ved permanent
leveringsfeil mottakeradressen i en suppresjonsliste (adresse + årsak).

