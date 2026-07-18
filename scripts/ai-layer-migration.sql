-- ============================================================================
-- AI-lag (delprosjekt 5) — produksjonsmigrering
-- ============================================================================
-- Formål: legger til grunnlaget for AI-genererte forslag og AI-personalisert
-- e-postutsending i flyt-motoren:
--   - "message_sends" får én ny kolonne:
--       "ai_personalized" — flagg (default false) som viser om innholdet i
--                            denne utsendelsen ble AI-omskrevet før sending
--   - "ai_suggestions" — ny tabell, én rad per AI-generert forslag knyttet
--     til en flyt (f.eks. forslag om oppfølging eller sendetidspunkt):
--       "flow_id"     — hvilken flyt forslaget gjelder, kaskade-slettes
--                        sammen med sin "flows"-rad
--       "kind"        — forslagstype ("followup" | "send_timing")
--       "title"       — kort tittel til visning i admin
--       "detail"      — JSON med forslagsdetaljer
--       "status"      — livssyklus ("open" | "dismissed" | "applied"),
--                        default "open"
--       "dedupe_key"  — unik nøkkel ({kind}:{flowId}:{YYYY-MM}) som hindrer
--                        at samme forslag genereres flere ganger i samme
--                        periode
--       "created_at" / "updated_at" — standard tidsstempler
--
-- Migreringen er REN TILLEGGSMIGRERING (additive):
--   - Ingen eksisterende tabeller, kolonner, indekser eller constraints
--     endres, fjernes eller migreres om.
--   - Kun én ny, ikke-nullbar kolonne med konstant default legges til på
--     "message_sends" ("ai_personalized"), pluss én helt ny tabell
--     ("ai_suggestions") med egen unik indeks ("dedupe_key"), én vanlig
--     sammensatt indeks ("flow_id", "status"), og én fremmednøkkel med
--     ON DELETE CASCADE mot "flows".
--
-- Generert med:
--   pnpm prisma migrate diff \
--     --from-schema-datamodel <schema.prisma før commit 8c07af1, "feat(ai): suggestion + personalized schema">, dvs. commit 40249bd ("feat(track): tracking schema") \
--     --to-schema-datamodel prisma/schema.prisma \
--     --script
--
-- Verifisert: commit 40249bd (siste commit før 8c07af1) → HEAD viser at
-- 8c07af1 er DEN ENESTE commiten i denne branchen som har rørt
-- prisma/schema.prisma siden da (git log --oneline 40249bd..HEAD --
-- prisma/schema.prisma). Diffen over fanger derfor nøyaktig og utelukkende
-- Task 3 sine skjematillegg — ingenting mer, ingenting mindre.
--
-- Trygt å kjøre direkte mot produksjonsdatabasen (Basefarm) uten nedetid:
--   - Alle operasjoner er ALTER TABLE ... ADD COLUMN / CREATE TABLE /
--     CREATE INDEX / ALTER TABLE ... ADD CONSTRAINT — ingen omskriving av
--     eksisterende data, ingen låser utover de korte metadata-låsene Postgres
--     tar for denne typen DDL.
--   - "ai_personalized BOOLEAN NOT NULL DEFAULT false" legges til på en
--     eksisterende tabell med eksisterende rader. I Postgres 11+ er dette en
--     ren metadata-operasjon når default-verdien er en konstant (som her) —
--     Postgres skriver IKKE default-verdien til hver eksisterende rad ved
--     ALTER TABLE, den lagres kun i tabellens metadata og leses lazy ved
--     neste tilgang til raden. Trygt og raskt uansett radantall.
-- ============================================================================

-- AlterTable
ALTER TABLE "message_sends" ADD COLUMN     "ai_personalized" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" SERIAL NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_suggestions_dedupe_key_key" ON "ai_suggestions"("dedupe_key");

-- CreateIndex
CREATE INDEX "ai_suggestions_flow_id_status_idx" ON "ai_suggestions"("flow_id", "status");

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
