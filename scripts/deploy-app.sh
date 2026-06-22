#!/usr/bin/env bash
#
# Deploy til Azure App Service (Kudu zipdeploy).
#
# Bruk:
#   AZURE_DEPLOY_USER='$dnt-travskole-app' AZURE_DEPLOY_PASS='...' ./scripts/deploy-app.sh
#
# Eller legg verdiene i .env.deploy (gitignored):
#   AZURE_DEPLOY_USER='$dnt-travskole-app'
#   AZURE_DEPLOY_PASS='...'
#
# Forutsetninger i Azure (engangsoppsett, bestilles hos Orange):
#   - Startup command: node server.js
#   - Miljøvariabler: se .env.example
#
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_URL='https://dnt-travskole-app.scm.azurewebsites.net/api/zipdeploy?isAsync=false'

if [[ -f .env.deploy ]]; then
  # shellcheck disable=SC1091
  source .env.deploy
fi

: "${AZURE_DEPLOY_USER:?Sett AZURE_DEPLOY_USER (f.eks. '\$dnt-travskole-app')}"
: "${AZURE_DEPLOY_PASS:?Sett AZURE_DEPLOY_PASS (fra Basefarm OTS-lenken)}"

echo "==> Kjører tester"
./node_modules/.bin/vitest run

echo "==> Bygger (standalone)"
# Kall binærene direkte (unngår pnpm/corepack-wrapper-gotchas). binaryTargets i
# prisma/schema.prisma sørger for at Linux-query-engines lastes ned også på macOS,
# og outputFileTracingIncludes (next.config.ts) bunter dem inn i standalone.
# VIKTIG: ren build hver gang. Slett forrige artefakt OG .next FØR bygget — ellers
# (a) tracer Next forrige deploy/ inn i standalone (nestet deploy/deploy/...), og
# (b) beholder .next/standalone stale source-.tsx fra tidligere bygg (Next rydder
# ikke standalone). Begge ville sendt kildekode/rapporter til prod-serveren.
rm -rf deploy app.zip .next
./node_modules/.bin/prisma generate
./node_modules/.bin/next build

echo "==> Pakker deploy-artefakt"
rm -rf deploy app.zip
mkdir deploy
# VIKTIG: -L dereferencer symlinks til ekte filer. Azure (Kudu zipdeploy) bevarer
# ikke symlinks, så uten dette blir f.eks. node_modules/next en knekt tekstfil og
# appen krasjer (require('next') -> SyntaxError). nodeLinker=hoisted
# (pnpm-workspace.yaml) gir flat node_modules slik at dette er trygt/uten sykler.
cp -RL .next/standalone/. deploy/
# SIKKERHET: Next standalone kopierer .env-filer inn i builden — de skal ALDRI
# deployes (ville overstyrt Azure App Settings i runtime). Prod leser env fra Azure.
find deploy -name '.env' -o -name '.env.*' | xargs -r rm -f
# Next tracer kopierer enkelte kilde-.tsx (metadata-image-ruter, client-grenser) inn
# i standalone. De trengs ALDRI ved runtime (appen kjører kompilert .js fra .next),
# og skal ikke ligge som kildekode på prod-serveren. Strip dem (ikke i node_modules).
find deploy -name '*.tsx' -not -path '*/node_modules/*' -delete
mkdir -p deploy/.next/static
cp -R .next/static/. deploy/.next/static/
cp -R public deploy/public

echo "==> Verifiserer artefakt"
if [[ -n "$(find deploy -name '.env' -o -name '.env.*')" ]]; then
  echo "FEIL: .env-filer i deploy-katalogen — avbryter"; exit 1
fi
if [[ -L deploy/node_modules/next || ! -d deploy/node_modules/next ]]; then
  echo "FEIL: deploy/node_modules/next er ikke en ekte katalog (symlink-problem) — avbryter"; exit 1
fi
if [[ -n "$(find deploy -type l)" ]]; then
  echo "FEIL: gjenværende symlinks i artefakt (overlever ikke zipdeploy) — avbryter"; exit 1
fi
if [[ -z "$(find deploy -name 'libquery_engine-debian*')" ]]; then
  echo "FEIL: Linux Prisma-query-engine mangler i artefakt — avbryter"; exit 1
fi
# Ikke-runtime-filer skal ALDRI på prod-serveren (kildekode, interne sikkerhets-/
# testrapporter, deploy-skript, eller en nestet deploy/-katalog).
if [[ -n "$(find deploy \( -name 'sec-review*.md' -o -name 'testit*.md' -o -name 'deploy-*.sh' \) )" || -d deploy/deploy ]]; then
  echo "FEIL: artefakt inneholder rapporter/skript/nestet deploy — avbryter"; exit 1
fi
if [[ -n "$(find deploy -name '*.tsx' -not -path '*/node_modules/*')" ]]; then
  echo "FEIL: artefakt inneholder kilde-.tsx (utenfor node_modules) — avbryter"; exit 1
fi
(cd deploy && zip -qr ../app.zip .)

echo "==> Deployer til Azure ($(du -h app.zip | cut -f1))"
HTTP_CODE=$(curl -sS -o /tmp/zipdeploy-response.txt -w '%{http_code}' \
  -X POST -u "${AZURE_DEPLOY_USER}:${AZURE_DEPLOY_PASS}" \
  --data-binary @app.zip \
  "$DEPLOY_URL")

if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "202" ]]; then
  echo "FEIL: zipdeploy svarte HTTP $HTTP_CODE"
  cat /tmp/zipdeploy-response.txt
  exit 1
fi

echo "==> Deploy OK (HTTP $HTTP_CODE)"
echo "    https://registrering.bjerke.no"
echo
echo "Skjemaendringer: brannmuren er stengt, så 'prisma db push' utenfra funker IKKE."
echo "  Kjør DDL via en engangs CRON_SECRET-beskyttet API-rute som kjører på app-en"
echo "  (prisma.\$executeRawUnsafe, idempotent). Generer DDL offline med:"
echo "  prisma migrate diff --from-schema-datamodel <gammel> --to-schema-datamodel prisma/schema.prisma --script"
