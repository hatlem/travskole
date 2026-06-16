#!/usr/bin/env bash
#
# Deploy Azure Function (cron) via Kudu zipdeploy.
#
# Bruk:
#   AZURE_FUNC_USER='$dnt-travskole-func' AZURE_FUNC_PASS='...' ./scripts/deploy-func.sh
#
# Eller legg verdiene i .env.deploy (gitignored).
#
# Forutsetning i Azure: app setting CRON_SECRET på Function-appen
# (samme verdi som web-appens CRON_SECRET).
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Func-appen kjører på Flex Consumption-planen, der legacy /api/zipdeploy ikke
# finnes (returnerer 404). Flex Consumption støtter KUN OneDeploy via Kudu
# data-plane: POST /api/publish?type=zip (fungerer med basic-auth deployment-
# credentials + curl — ingen Azure AD/RBAC nødvendig).
DEPLOY_URL='https://dnt-travskole-func.scm.azurewebsites.net/api/publish?type=zip'

if [[ -f .env.deploy ]]; then
  # shellcheck disable=SC1091
  source .env.deploy
fi

: "${AZURE_FUNC_USER:?Sett AZURE_FUNC_USER (f.eks. '\$dnt-travskole-func')}"
: "${AZURE_FUNC_PASS:?Sett AZURE_FUNC_PASS (fra Basefarm OTS-lenken)}"

echo "==> Pakker functions"
rm -f func.zip
(cd azure-functions && zip -qry ../func.zip .)

echo "==> Deployer til Azure Functions (OneDeploy /api/publish)"
HTTP_CODE=$(curl -sS -o /tmp/zipdeploy-func-response.txt -w '%{http_code}' \
  -X POST -u "${AZURE_FUNC_USER}:${AZURE_FUNC_PASS}" \
  -H 'Content-Type: application/zip' \
  --data-binary @func.zip \
  "$DEPLOY_URL")

if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "202" ]]; then
  echo "FEIL: zipdeploy svarte HTTP $HTTP_CODE"
  cat /tmp/zipdeploy-func-response.txt
  exit 1
fi

echo "==> Deploy OK (HTTP $HTTP_CODE)"
