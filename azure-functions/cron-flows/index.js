// Hver 5. minutt: drive flowtilstand fram for aktive enrollments.
//
// Krever app setting CRON_SECRET på Function-appen — samme verdi som
// web-appens CRON_SECRET. Ingen npm-avhengigheter (bruker global fetch).
module.exports = async function (context) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error('CRON_SECRET er ikke satt på Function-appen');
  }

  const url =
    process.env.CRON_TARGET_URL_FLOWS ||
    'https://registrering.bjerke.no/api/cron/flows';
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Cron-endepunktet svarte ${res.status}: ${body}`);
  }

  context.log(`Flowtilstand kjørt OK: ${body}`);
};
