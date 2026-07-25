-- ⚠️ IRREVERSIBELT — delprosjekt C. Kjøres SIST, av Basefarm, og KUN NÅR:
--   (1) kurs-livssyklus-flyten (delprosjekt B) er aktivert i prod,
--   (2) paritet er bevist, og
--   (3) e-posthistorikken (email_logs) er arkivert eller ikke lenger nødvendig.
-- IKKE kjør sammen med kode-deployen. Rekkefølge følger FK-avhengighetene.
DROP TABLE IF EXISTS email_logs;
DROP TABLE IF EXISTS email_triggers;
DROP TABLE IF EXISTS email_templates;
