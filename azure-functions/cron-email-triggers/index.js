// Daglig kl. 07:00 UTC: trigger planlagte kurs-e-poster
// (påminnelser, velkommen, midtveis, etter kursslutt).
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
    'https://registrering.bjerke.no/api/cron/email-triggers';
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Cron-endepunktet svarte ${res.status}: ${body}`);
  }

  context.log(`E-posttriggere kjørt OK: ${body}`);
};
