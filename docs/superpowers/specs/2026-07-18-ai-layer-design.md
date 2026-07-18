# AI-lag — Design Spec (delprosjekt 5)

*Subproject 5 of the Engagement Platform. Builds on delprosjekt 3 (flow engine/editor) and 4 (tracking data). All four AI capabilities from the umbrella architecture are in scope, sharing one provider layer. Suggestion-display UI is deferred to delprosjekt 6 (engine + storage built now).*

## Overview

An LLM layer over the flow engine: editor assist (subject variants, tone, shorten) in the node-config-panel, whole-sequence generation from a goal description, opt-in per-recipient personalization at send time, and a rule-based engagement analyzer that stores follow-up/send-timing suggestions for delprosjekt 6 to render. Everything is config-gated: no API key → every feature disappears/no-ops and the platform behaves exactly as it does today (same degradation contract as Stripe/Vipps). All AI is server-side; keys never reach the client.

**Non-goals:** autonomous actions against active flows (suggestions only, admin approves), suggestion-display UI (delprosjekt 6), SMS/push, migrating existing EmailTriggers.

## LLM-provider (`lib/ai/`)

- `lib/ai/provider.ts`: `interface LLMProvider { generateText(prompt: string, opts?: { system?: string; maxTokens?: number; temperature?: number }): Promise<string | null> }` — returns `null` on any provider/network error (fire-safe, logged, never throws). `getLLMProvider(): LLMProvider | null` reads env: `AI_PROVIDER` (`anthropic` | `openai`, default `anthropic`), then the selected provider's keys; returns `null` when unconfigured. `isAiConfigured(): boolean` convenience wrapper.
- `lib/ai/anthropic.ts`: thin `fetch` against Anthropic Messages API (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` default `claude-sonnet-5`). No SDK dependency (same pattern as vipps.ts).
- `lib/ai/openai.ts`: thin `fetch` against an OpenAI-compatible chat-completions endpoint (`OPENAI_API_KEY`, `OPENAI_BASE_URL` default `https://api.openai.com/v1`, `OPENAI_MODEL` default `gpt-4o-mini`). Covers any OpenAI-compatible host via base-URL override.
- Timeout ~10s per call (AbortController). Aldri logg nøkler eller fulle prompts med persondata — kun feilstatus/varighet.
- Klient-synlighet: en admin-gated `GET /api/admin/crm/ai/status` → `{ configured: boolean }` slik at editor-UI kan skjule KI-knappene uten å eksponere env til klienten.

## Guardrails (`lib/ai/guardrails.ts`, TDD)

`validateAiRewrite(original: string, rewritten: string): { ok: true } | { ok: false; reason: string }` — pure, runs on EVERY content-producing LLM output before use. Rejects when the rewrite:
- contains an `http(s)://`-URL not present in original,
- contains a price-pattern (`kr\s*\d`, `\d\s*kr`, `NOK`) not present in original,
- contains a date-pattern (norske dag/månedsnavn, `\d{1,2}\.\d{1,2}\.`, ISO-datoer) not present in original,
- mangler eller endrer merge-tags: settet av `{{...}}`-tagger i original må overleve verbatim,
- er tom eller >3× originalens lengde (degenerert respons).

Rejection ⇒ caller falls back to the original text (personalization/tone/shorten) or returns a Norwegian error (editor assist UI). For generated-from-scratch copy (sequence generation) the baseline is the empty string ⇒ effectively: no URLs/prices/dates at all in generated drafts — admin adds real links/prices manually in the editor.

## Redigeringsassistent

- Node-config-panelet (e-post-noder) får en «KI-hjelp»-seksjon, kun synlig når `/api/admin/crm/ai/status` sier configured: **Emneforslag** (3 varianter), **Juster tone** (formell/vennlig/kort og direkte), **Forkort**.
- `POST /api/admin/crm/ai/assist` (admin-session + Zod): `{ kind: 'subject_variants' | 'tone' | 'shorten', subject: string, bodyHtml: string, tone?: string }` → `{ suggestions: string[] }` (subject) eller `{ result: string }` (body). Body-rewrites valideres med `validateAiRewrite` server-side; avvist ⇒ 422 med norsk feilmelding.
- Forslag er klikkbare valg som erstatter feltinnholdet i lokal editor-state — admin må fortsatt lagre noden selv. AI-en skriver aldri til databasen.
- Prompts på norsk; systemprompt krever bokmål-output og uendrede merge-tags.

## Sekvens-generering

- «Generer med KI»-knapp på `/admin/crm/flyter` (skjult uten provider): skjema med mål (fritekst), antall e-poster (1–5), avsenderidentitet.
- `POST /api/admin/crm/ai/generate-flow` (admin + Zod). LLM bes om STRIKT JSON: `{ name: string, nodes: [{ type: 'email', subject, bodyHtml } | { type: 'wait', days } | { type: 'condition', kind: 'opened_email' }] }` — en lineær sekvens, valgfritt med maks én `opened_email`-forgrening. Vokabularet er begrenset til nodetyper motoren allerede støtter.
- **Serveren bygger grafen selv** (start-node, kanter, ja/nei-grener, slutt-noder) med samme logikk som editoren — LLM-en produserer kun innhold/rekkefølge og kan ikke lage en strukturelt ugyldig graf. `validateFlow` kjøres likevel på resultatet før lagring.
- Hver generert e-postkropp valideres mot tom baseline (ingen URL-er/priser/datoer). Flyten opprettes med `status: 'draft'`; respons sender admin rett inn i editoren for gjennomgang og manuell aktivering. Uparsbar/ugyldig LLM-output ⇒ norsk feilmelding, ingenting lagres, ingen stille retries.

## Per-mottaker-personalisering

- E-post-nodens config får valgfritt `aiPersonalize: boolean` (avkrysningsboks i panelet, kun synlig med provider). `validateFlow` behandler feltet som valgfritt — eksisterende flyter uendret.
- I `sendFlowEmail`: ETTER merge-tag-rendering, FØR avmeldingsfooter/sporings-omskriving — hvis `aiPersonalize` && provider && markedsføringssending: ett LLM-kall omskriver kroppen for akkurat denne kontakten. Kontekst: navn, org-navn, stage, tags, siste deal-eventtyper — ALDRI e-postadresse, aldri andre kontakters data.
- **Fail-safe:** enhver feil/timeout/guardrail-avvisning ⇒ original kropp sendes, warning logges, flyten fortsetter. Dedupe-/MessageLink-/gjenopprettingsmaskineriet fra delprosjekt 4 berøres ikke (transformen skjer før alt det). 10s-timeout beskytter runner-batchen.
- **Audit:** `MessageSend` får additiv kolonne `aiPersonalized Boolean @default(false)`; lagret `bodyHtml` er allerede den faktisk sendte (personaliserte) kroppen.

## Engasjementsanalyse (motor nå, UI i delprosjekt 6)

- Ny modell `AiSuggestion`: `id`, `flowId` (FK, Cascade), `kind` (`followup` | `send_timing`), `title` (norsk), `detail` (JSON-streng), `status` (`open` | `dismissed` | `applied`), `dedupeKey String @unique` (flow+kind+analysevindu), `createdAt`/`updatedAt`.
- `lib/ai/analyze.ts` (TDD, ren): `analyzeFlowEngagement(sends: SendStats[]): SuggestionCandidate[]` — deterministisk regelbasert: (a) ≥N sendinger siste X dager med `openedAt` null og ingen oppfølgingsnode etter ⇒ `followup`-forslag; (b) åpningsrate-fordeling per time ⇒ `send_timing`-forslag. LLM brukes valgfritt kun til å formulere `title` pent (fallback: fast norsk mal-tekst).
- Kjøres som lavfrekvent steg i eksisterende `/api/cron/flows`-tick — maks én analyse per flyt per døgn (Setting-basert tidsstempel, samme mønster som Graph-cursorene). Fire-safe: analysefeil logges og hopper over, aldri 500.
- Ingen UI i dette delprosjektet; delprosjekt 6 leser/viser/agerer på `AiSuggestion`-radene.

## GDPR

Kun nødvendige kontaktfelter sendes til LLM-leverandøren (navn/org/stage/tags/deal-typer — aldri e-postadresse, fødselsdato, allergier eller fritekst-notater). Databehandleravtale med valgt leverandør er en deploy-forutsetning (dokumenteres i Åpne tråder). Ingen treningsbruk: standard API-vilkår (Anthropic/OpenAI API trener ikke på API-data). Personaliserte kropper lagres kun der de allerede lagres (`MessageSend.bodyHtml`) og følger eksisterende sletteregler (Contact-cascade).

## Testing

TDD: `guardrails.ts` (alle regelklassene + merge-tag-bevaring), `analyze.ts` (begge forslagstypene, dedupe-nøkkel, tomme data). Provider-klientene: TDD på ren request-bygging/respons-parsing med injisert fetch. Tynne lag (assist/generate-flow-endepunkter, send-hook, cron-steg) via tsc + suite + build. Finish-task: live smoke med ekte nøkkel hvis tilgjengelig i dev (ellers mock-verifisering av no-op-stiene).

## Migrering & utrulling

Additiv SQL (`scripts/ai-layer-migration.sql`): `AiSuggestion`-tabell + `message_sends.ai_personalized`-kolonne. Nye env-vars: `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (alle valgfrie — udefinert ⇒ AI helt av). Databehandleravtale med LLM-leverandør før produksjonsbruk med ekte kontaktdata.
