// Daglig kl. 07:00 UTC: GDPR-retensjon (barn-anonymisering når
// data_retention_days > 0, + purge av anonyme besøkende eldre enn 180 dager).
// (De planlagte kurs-e-postene håndteres nå av flyt-motoren, ikke denne cronen —
// se delprosjekt C.) Function-mappa heter fortsatt `cron-email-triggers` for å
// beholde timer-identiteten; målruta er omdøpt til `/api/cron/gdpr-retention`.
//
// Krever app setting CRON_SECRET på Function-appen — samme verdi som
// web-appens CRON_SECRET. Ingen npm-avhengigheter (bruker global fetch).
module.exports = async function (context) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error('CRON_SECRET er ikke satt på Function-appen');
  }

  const url =
    process.env.CRON_TARGET_URL ||
    'https://registrering.bjerke.no/api/cron/gdpr-retention';
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Cron-endepunktet svarte ${res.status}: ${body}`);
  }

  context.log(`GDPR-retensjon kjørt OK: ${body}`);
};
