-- ============================================================================
-- Event bus (delprosjekt 2a) — produksjonsmigrering
-- ============================================================================
-- Formål: legger til to nye tabeller, "visitors" og "app_events", som utgjør
-- grunnmuren i hendelsesbussen (anonym besøkssporing + identity stitching mot
-- kontakter, samt en generell hendelseslogg for admin-visning under CRM).
--
-- Migreringen er REN TILLEGGSMIGRERING (additive):
--   - Ingen eksisterende tabeller, kolonner, indekser eller constraints endres,
--     fjernes eller migreres om.
--   - Kun to nye tabeller opprettes, med tilhørende indekser og fremmednøkler.
--   - Fremmednøklene mot "contacts" bruker ON DELETE SET NULL, slik at sletting
--     av en kontakt aldri kaskaderer og fjerner besøks- eller hendelsesdata —
--     koblingen nulles bare ut.
--
-- Generert med:
--   pnpm prisma migrate diff \
--     --from-schema-datamodel <schema før 9f536d6> \
--     --to-schema-datamodel prisma/schema.prisma \
--     --script
--
-- Trygt å kjøre direkte mot produksjonsdatabasen (Basefarm). Ingen nedetid
-- eller låsing av eksisterende tabeller forventes — kun CREATE TABLE/INDEX og
-- ALTER TABLE ... ADD CONSTRAINT på de to nye tabellene.
-- ============================================================================

-- CreateTable
CREATE TABLE "visitors" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "contact_id" INTEGER,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_events" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "contact_id" INTEGER,
    "visitor_id" INTEGER,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visitors_public_id_key" ON "visitors"("public_id");

-- CreateIndex
CREATE INDEX "visitors_contact_id_idx" ON "visitors"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_events_dedupe_key_key" ON "app_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "app_events_type_idx" ON "app_events"("type");

-- CreateIndex
CREATE INDEX "app_events_contact_id_occurred_at_idx" ON "app_events"("contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "app_events_visitor_id_occurred_at_idx" ON "app_events"("visitor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "app_events_occurred_at_idx" ON "app_events"("occurred_at");

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
