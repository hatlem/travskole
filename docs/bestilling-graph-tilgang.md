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
  KUN de 7 avsenderpostboksene under — ikke hele organisasjonens postbokser
  (minste-privilegium).
- Levering av `tenant ID`, `client ID` og `client secret` (eller et
  sertifikat, om det foretrekkes) via en sikker/hemmelig kanal (ikke e-post i
  klartekst). Appen setter selv miljøvariabelen `GRAPH_MAILBOXES`
  (kommaseparert liste over de 7 adressene under), så du trenger ikke oppgi
  den — kun de tre hemmelighetene over.

## De 7 postboksene som skal scopes

- registrering@bjerke.no
- hilde.apneseth@bjerke.no
- andre.ringelien@bjerke.no
- hege.karin.arverud@bjerke.no
- stine.rasmussen@bjerke.no
- bjerke@bjerke.no
- arild.engebretsen@bjerke.no

## Samtidig — en liten påminnelse

Begge webhook-endepunktene finnes nå og er live (verifisert: 401 uten gyldig
signatur, som forventet):

- `/api/webhooks/stripe`
- `/api/webhooks/vipps`

Vi registrerer selv webhook-URL-ene i Stripe-dashboardet og i Vipps' webhook-API
når vi er klare — kommer tilbake med de resulterende signeringshemmelighetene
via sikker lenke da. Ingen handling fra dere før det.
