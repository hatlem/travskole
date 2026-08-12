# Epost til Basefarm — utrulling av engasjementsplattformen (registrering.bjerke.no)

*Sendt 2026-08-11 (svar på Patryks avklaringsspørsmål om ansvarsfordeling). Historisk
referanse — se `docs/deploy-runbook.md` + `docs/go-live-checklist.md` for gjeldende
detaljer per steg.*

---

**Til:** Patryk Hilscher (Basefarm/Orange)
**Emne:** Re: Bjerkebanen - Registrering — ansvarsfordeling avklart

Hei Patryk,

Beklager at forrige mail var uklar her — den forutsatte feilaktig at dere skulle ha
tilgang til appens repo/SQL-filer, noe som aldri har vært hvordan dette har fungert
(dere har alltid gitt oss FTPS-tilgang til å deploye selv, slik dere satte opp i juni).
La meg rydde opp i ansvarsfordelingen:

**Det vi (Admirate) gjør selv, som før:**
- Deploy av web-app-koden til dnt-travskole-app (FTPS zipdeploy, samme mekanisme som i
  juni, `scripts/deploy-app.sh`)
- Deploy av Azure Function-koden til dnt-travskole-func (samme FTPS-mekanisme,
  `scripts/deploy-func.sh`) — dette inkluderer en ny cron-jobb (cron-flows) i tillegg
  til den eksisterende cron-email-triggers
- Kjøring av databasemigreringene — DB-en er brannmurslåst mot ekstern tilgang (dere
  stengte den for oss i juni etter forrige migrering), så vi kjører dem fra app-en selv
  via en sikret engangs-rute (`/api/admin/deploy-migration`, SEED_SECRET-beskyttet, samme
  mønster som den tidligere `/api/migrate`-ruta). Dere trenger ikke røre SQL i det hele tatt.
- Registrering av Stripe/Vipps-webhookene i deres dashboard
- Aktivering av den nye «Kurs-livssyklus»-flyten i admin + røyktest

**Det vi trenger fra dere (Azure-konfigurasjon vi ikke har tilgang til):**
1. Bekreftet ✅ — `CRON_SECRET` + `NEXTAUTH_SECRET` på App Service, samme `CRON_SECRET`
   på Function-appen.
2. `CRON_TARGET_URL_FLOWS=https://registrering.bjerke.no/api/cron/flows` på
   Function-appen — bekreftet, legges til. Vi deployer selve cron-flows-jobben i samme
   runde, så den er klar til å bli truffet av timeren så snart env-variabelen er der.
3. Når vi har registrert webhookene: `STRIPE_WEBHOOK_SECRET` (+ `_TEST`) og
   `VIPPS_WEBHOOK_SECRET` som App Service-settings — verdiene sender vi via sikker lenke
   som før.
4. Litt lenger frem (ikke nå, ikke blokkerende): en Microsoft Graph-appregistrering for
   svar-stopp/bounce-håndtering (`docs/bestilling-graph-tilgang.md`) — sender egen
   bestilling når vi er klare for det.

Ingen `.md`-filer eller SQL-filer trengs fra dere — de var ment som vår egen interne
referanse, beklager at forrige mail ga inntrykk av noe annet.

Si ifra om dette gir mening, så setter vi i gang!

Mvh
Andreas
