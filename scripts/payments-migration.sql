-- Produksjonsmigrasjon: betalingsfelter på registrations og booking_requests
-- (delprosjekt 2b — Stripe/Vipps-betaling).
--
-- Formål: legger til payment_status/payment_provider/payment_ref-kolonner
-- pluss unike indekser på payment_ref, slik at eksisterende
-- registrerings-/booking-rader kan spores gjennom betalingsflyten uten å
-- røre eksisterende data.
--
-- Kun additive endringer: ALTER TABLE ... ADD COLUMN og CREATE UNIQUE INDEX.
-- Ingen DROP, RENAME eller endring av eksisterende kolonner — trygt å kjøre
-- mot en produksjonsdatabase med data uten nedetid eller datatap.
--
-- Generert med:
--   pnpm exec prisma migrate diff \
--     --from-schema-datamodel <schema.prisma før commit cf45f06> \
--     --to-schema-datamodel prisma/schema.prisma \
--     --script

-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN     "payment_provider" TEXT,
ADD COLUMN     "payment_ref" TEXT,
ADD COLUMN     "payment_status" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "payment_provider" TEXT,
ADD COLUMN     "payment_ref" TEXT,
ADD COLUMN     "payment_status" TEXT NOT NULL DEFAULT 'none';

-- CreateIndex
CREATE UNIQUE INDEX "booking_requests_payment_ref_key" ON "booking_requests"("payment_ref");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_payment_ref_key" ON "registrations"("payment_ref");
