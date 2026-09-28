# Phase 5B + 5C

Apply `supabase/migrations/20260928122500_phase5bc_claims_and_insights.sql` once after 00015, then deploy/restart the application. Do not rerun older migrations. No new environment variables: 5B uses the existing server-only GEMINI_API_KEY and native HTTPS transport. Production SQL is not applied by this task.

## AI conclusions

Analytics has a separate explicit “Сформировать AI-выводы” action. The server re-reads deterministic hotspot/systemic/service RPC results for the selected filters; it accepts no client facts. Gemini selects two short Russian formulations of those computed facts. Each output sentence must exactly match an approved formulation with the authoritative values, in source order. Anything else (including altered numbers, ranking, predictions, new classifications or extra text) is discarded. This intentionally constrained verbalizer cannot invent a displayed fact. No organization names or resident descriptions/photos are sent. Missing key, RPC/model/network/validation failures leave all original analytics functional.

## Offers, claims and review

New tasks stay unassigned until an eligible active organization's executor explicitly claims, even if only one organization is eligible. Every matching organization sees the same available task. For `other`, eligibility uses the trusted accepted/matched discovery category, never a client-written ai_category. Otherwise it uses the original category. Phase 5A retains classification/audit behavior, but no longer auto-assigns an organization.

Claim derives organization from authenticated membership. A report row lock and a unique partial index permit exactly one active claim. Same-organization retries are idempotent. Other organizations receive a conflict and lose mutation/evidence/storage authorization immediately in the database. Realtime updates invalidate the UI; five-second polling is a fallback. Public report reads remain public.

Evidence is bound to the active claim in a database trigger. Only its organization can submit. Independent review checks the evidence author as before. Reject/reopen releases the matching claim in the same transaction and returns the task to all eligible organizations. Verified evidence is final: neither residents nor developers can reopen it. This finality supersedes the earlier developer ability to reopen an already verified result.

Claim history records organization, claimant UUID, claim/release timestamps and release actor, plus public timeline events. Evidence claim attribution cannot be changed. Only server-controlled RPCs/triggers write these records.

## Existing data and service metrics

Existing organization assignments stay in place. They receive explicit legacy_assignment claim records with null claimant/date; no historical click/time is invented. Existing current evidence is associated with that legacy assignment. Old reopened evidence with unknown prior organization is not guessed. Existing report/evidence contents and states are unchanged.

Never-claimed tasks are excluded from organization metrics. Released attempts remain in their actual organization's work/decision history; an available task does not count as active work for that former organization. A later claimant does not inherit previous rejection decisions. Verified work is attributed through the evidence claim. New work durations start at claimed_at, excluding time waiting for an organization. Legacy durations retain report-created-time fallback because a historical claim time is unknown. Drilldowns follow recorded claim history. Lists remain alphabetical, not a ranking.

## Focused verification

- `node tests/phase5bc-api.cjs`
- `PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/claims-migration.mjs`
- For native PostgreSQL concurrency: run the same test against a fresh disposable database with CLAIM_TEST_DATABASE_URL (never production), PG_MODULE pointing to pg/lib/index.js, and PGLITE_MODULE set. Two independent sessions verify actual lock contention, one commit and one conflict.
- Anonymous history, category image/transport, review API and analytics client regressions.
- `npm run typecheck` and `npm run build`.
