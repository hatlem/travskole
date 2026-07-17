-- ============================================================================
-- Flyt-motor (delprosjekt 3) — produksjonsmigrering
-- ============================================================================
-- Formål: legger til syv nye tabeller som utgjør flyt-motoren (automatiserte
-- e-post-/handlings-sekvenser bygget som en graf: start → e-post/vent/
-- betingelse/handling → slutt), pluss avsender-identiteter og en logg over
-- utsendte meldinger:
--   - "flows"             — selve flyten (navn, status, om den er markedsføring)
--   - "flow_nodes"        — nodene i grafen (type + JSON-konfig per nodetype)
--   - "flow_edges"        — koblingene mellom noder (inkl. ja/nei-grener)
--   - "flow_triggers"     — hvilke bus-hendelser som starter flyten automatisk
--   - "flow_enrollments"  — hver kontakts posisjon/fremdrift i en flyt
--   - "sender_identities" — de 7 verifiserte bjerke.no-avsenderadressene
--   - "message_sends"     — logg over hver e-post sendt fra en flyt (idempotent
--                            via unik "dedupe_key")
--
-- Migreringen er REN TILLEGGSMIGRERING (additive):
--   - Ingen eksisterende tabeller, kolonner, indekser eller constraints endres,
--     fjernes eller migreres om.
--   - Kun de syv tabellene over opprettes, med tilhørende indekser og
--     fremmednøkler.
--   - "flow_enrollments" og "message_sends" har fremmednøkler mot "contacts"
--     med ON DELETE CASCADE — sletting av en kontakt sletter også dens
--     flyt-historikk (konsistent med hvordan kontakt-relaterte tabeller som
--     "deals"/"activities" allerede oppfører seg i skjemaet).
--   - "message_sends.sender_identity_id" bruker ON DELETE SET NULL, slik at en
--     avsender-identitet kan deaktiveres/fjernes uten å slette sendelogger.
--
-- Generert med:
--   pnpm prisma migrate diff \
--     --from-schema-datamodel <schema.prisma før commit b3582fd, "feat(flows): flow engine schema"> \
--     --to-schema-datamodel prisma/schema.prisma \
--     --script
--
-- Verifisert: ingen skjema-endringer siden b3582fd utover denne migreringen.
-- Den eneste senere commiten som rørte prisma/schema.prisma
-- ("fix(flows): guard system sentinel contact", ffa4403) endret kun en
-- kode-kommentar på "contacts.source" (la til "|system" i doc-kommentaren) —
-- ingen faktisk kolonne/type/default ble endret, så basisen for denne
-- migreringen er uendret og trygg.
--
-- Trygt å kjøre direkte mot produksjonsdatabasen (Basefarm) uten nedetid —
-- kun CREATE TABLE / CREATE INDEX / ALTER TABLE ... ADD CONSTRAINT.
-- ============================================================================

-- CreateTable
CREATE TABLE "flows" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "is_marketing" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_nodes" (
    "id" SERIAL NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "pos_x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pos_y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_edges" (
    "id" SERIAL NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "from_node_id" INTEGER NOT NULL,
    "to_node_id" INTEGER NOT NULL,
    "branch" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_triggers" (
    "id" SERIAL NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "filter" TEXT NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_enrollments" (
    "id" SERIAL NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "current_node_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sender_identities" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_sends" (
    "id" SERIAL NOT NULL,
    "enrollment_id" INTEGER,
    "node_id" INTEGER,
    "contact_id" INTEGER NOT NULL,
    "sender_identity_id" INTEGER,
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "dedupe_key" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flow_nodes_flow_id_idx" ON "flow_nodes"("flow_id");

-- CreateIndex
CREATE INDEX "flow_edges_flow_id_idx" ON "flow_edges"("flow_id");

-- CreateIndex
CREATE INDEX "flow_triggers_event_type_idx" ON "flow_triggers"("event_type");

-- CreateIndex
CREATE INDEX "flow_enrollments_status_next_run_at_idx" ON "flow_enrollments"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "flow_enrollments_flow_id_contact_id_status_idx" ON "flow_enrollments"("flow_id", "contact_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sender_identities_email_key" ON "sender_identities"("email");

-- CreateIndex
CREATE UNIQUE INDEX "message_sends_dedupe_key_key" ON "message_sends"("dedupe_key");

-- CreateIndex
CREATE INDEX "message_sends_contact_id_sent_at_idx" ON "message_sends"("contact_id", "sent_at");

-- AddForeignKey
ALTER TABLE "flow_nodes" ADD CONSTRAINT "flow_nodes_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_edges" ADD CONSTRAINT "flow_edges_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_triggers" ADD CONSTRAINT "flow_triggers_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_enrollments" ADD CONSTRAINT "flow_enrollments_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_enrollments" ADD CONSTRAINT "flow_enrollments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_sends" ADD CONSTRAINT "message_sends_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_sends" ADD CONSTRAINT "message_sends_sender_identity_id_fkey" FOREIGN KEY ("sender_identity_id") REFERENCES "sender_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
