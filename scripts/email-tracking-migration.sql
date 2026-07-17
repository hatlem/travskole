-- ============================================================================
-- E-postsporing (delprosjekt 4) — produksjonsmigrering
-- ============================================================================
-- Formål: legger til sporing av åpninger og klikk på utsendte flyt-e-poster,
-- pluss grunnlaget for svar-/bounce-håndtering:
--   - "message_sends" får syv nye kolonner:
--       "tracking_token"    — unik 24-tegns hex-token brukt av sporingspixel
--                              og klikk-redirect (satt ved utsending)
--       "message_id"        — Graph/Internet-Message-Id, brukt til å matche
--                              svar og bounces tilbake til riktig utsendelse
--       "opened_at"         — tidspunkt for første registrerte åpning
--       "first_clicked_at"  — tidspunkt for første registrerte klikk
--       "click_count"       — antall registrerte klikk (default 0)
--       "replied_at"        — tidspunkt meldingen ble besvart
--       "bounced_at"        — tidspunkt meldingen ble rapportert som bounce
--   - "message_links" — ny tabell, én rad per lenke i en utsendt e-post
--     (idx + mål-URL), brukt av klikk-redirect-ruten til å slå opp riktig
--     mål-URL for et gitt (message_send, idx)-par. Kaskade-slettes sammen med
--     sin "message_sends"-rad.
--
-- Migreringen er REN TILLEGGSMIGRERING (additive):
--   - Ingen eksisterende tabeller, kolonner, indekser eller constraints
--     endres, fjernes eller migreres om.
--   - Kun nye, nullbare kolonner legges til på "message_sends" (unntaket er
--     "click_count", som får en konstant default på 0 — se merknad under),
--     pluss én ny unik indeks ("tracking_token"), én ny vanlig indeks
--     ("message_id"), og én helt ny tabell ("message_links") med egen
--     fremmednøkkel og ON DELETE CASCADE mot "message_sends".
--   - "message_links" sin "@@unique([messageSendId, idx])" er en vanlig
--     (ikke-partial) sammensatt unik constraint, fullt uttrykkbar i
--     schema.prisma — i motsetning til flyt-motor-migreringen
--     (scripts/flow-engine-migration.sql) er det INGEN manuelt vedlikeholdt
--     partial-indeks-tillegg her. "prisma migrate diff" fanger opp hele
--     skjemaendringen på egen hånd.
--
-- Generert med:
--   pnpm prisma migrate diff \
--     --from-schema-datamodel <schema.prisma før commit 40249bd, "feat(track): tracking schema"> \
--     --to-schema-datamodel prisma/schema.prisma \
--     --script
--
-- Verifisert: commit 513b7d0 (siste commit før 40249bd) → HEAD viser at
-- 40249bd er DEN ENESTE commiten i denne branchen som har rørt
-- prisma/schema.prisma siden da (git log --oneline 513b7d0..HEAD --
-- prisma/schema.prisma). Diffen over fanger derfor nøyaktig og utelukkende
-- Task 2 sine skjematillegg — ingenting mer, ingenting mindre.
--
-- Trygt å kjøre direkte mot produksjonsdatabasen (Basefarm) uten nedetid:
--   - Alle operasjoner er ALTER TABLE ... ADD COLUMN / CREATE INDEX /
--     CREATE TABLE / ALTER TABLE ... ADD CONSTRAINT — ingen omskriving av
--     eksisterende data, ingen låser utover de korte metadata-låsene Postgres
--     tar for denne typen DDL.
--   - "click_count INTEGER NOT NULL DEFAULT 0" legges til på en eksisterende
--     tabell med eksisterende rader. I Postgres 11+ er dette en ren
--     metadata-operasjon når default-verdien er en konstant (som her) —
--     Postgres skriver IKKE default-verdien til hver eksisterende rad ved
--     ALTER TABLE, den lagres kun i tabellens metadata og leses lazy ved
--     neste tilgang til raden. Trygt og raskt uansett radantall.
-- ============================================================================

-- AlterTable
ALTER TABLE "message_sends" ADD COLUMN     "bounced_at" TIMESTAMP(3),
ADD COLUMN     "click_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "first_clicked_at" TIMESTAMP(3),
ADD COLUMN     "message_id" TEXT,
ADD COLUMN     "opened_at" TIMESTAMP(3),
ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "tracking_token" TEXT;

-- CreateTable
CREATE TABLE "message_links" (
    "id" SERIAL NOT NULL,
    "message_send_id" INTEGER NOT NULL,
    "idx" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_links_message_send_id_idx_key" ON "message_links"("message_send_id", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "message_sends_tracking_token_key" ON "message_sends"("tracking_token");

-- CreateIndex
CREATE INDEX "message_sends_message_id_idx" ON "message_sends"("message_id");

-- AddForeignKey
ALTER TABLE "message_links" ADD CONSTRAINT "message_links_message_send_id_fkey" FOREIGN KEY ("message_send_id") REFERENCES "message_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;
