# Phase 5D/E fixes + 5F

Apply `supabase/migrations/20260928175531_phase5f_delivery_and_required_gps.sql` AFTER the Phase 5B/C and 5D/E migrations. Do not rerun applied migrations. Deploy code and SQL together: older clients without GPS will be refused, and old `select *` evidence clients will need a refresh. No existing data is rewritten and no historical external messages are backfilled.

## Required GPS and private diagnostics

New evidence automatically requests current geolocation (maximumAge=0, timeout 10 seconds, outer deadline 12 seconds). Denied/unavailable/stale GPS prevents upload/submission and asks the executor to enable location and retry. API and authenticated 4-argument submission RPC require valid coordinates, nonnegative accuracy and sample age within 2 minutes (at most 30 seconds future clock skew). The old 3-argument RPC cannot bypass this. DB computes and stores only derived distance/accuracy inside the same transaction as evidence; exact GPS is never persisted. Poor accuracy and short work time remain warnings, not rejection criteria. Existing evidence is untouched.

Executors see only the simple submission/review state, without AI scores/reasoning or trust warnings. Original/evidence photos and public history remain visible. Internal AI column access is revoked from public/authenticated direct reads; developer-only RPC supplies full review details. Trust RLS now permits only enabled developers. Reviewer independence/final resolution remain enforced.

Notifications link and unread count appear in the main desktop/mobile staff header and dashboard sidebar for both roles.

## External delivery setup (manual, no credentials in chat)

Current organization configuration contains email and WhatsApp. Previous providers were formatting-only placeholders. New real integration: **Resend email API**. WhatsApp, Telegram, generic API and web are explicitly unsupported and recorded as blocked; no simulated success.

Server environment:
- Existing `SUPABASE_SERVICE_ROLE_KEY`.
- `RESEND_API_KEY`: Resend sending key (server only).
- `RESEND_FROM_EMAIL`: an email address on a domain verified in Resend; bare email address, no display-name wrapper.
- `AYAN_SITE_URL`: canonical HTTPS production root, for example `https://aqtau.vercel.app` (use the actual domain).
- `CRON_SECRET`: a random secret of at least 32 characters, server only.

Keep organization `channel=email`, `destination` equal to its real single recipient address. Configure contacts through the existing administrative process. Do not change WhatsApp organizations to email without their actual address.

Schedule authenticated POST `/api/internal/notifications/dispatch` every minute. This is independent of browser activity and avoids relying on Vercel Hobby's limited cron frequency. A ready SQL recipe is `docs/phase5f-scheduler.sql`; it uses Supabase Cron + pg_net and Vault names, never credentials in SQL/job text. Enable Cron/pg_net in Supabase, create the two Vault secrets named in that file, review then run the recipe. Each run processes up to 3 messages; overlapping runs use row locks/leases. No scheduler has been installed in production by this change.

The operator sees configuration readiness and statuses in `/dashboard/notifications` → «Внешние уведомления». Correct blocked configuration then choose retry. Normal events need no manual generation. No live provider credentials were present in local env; actual production email sending is **not yet verified**. After setup, use a designated recipient for one approved smoke test; tests never send real messages.

## Events and content

Atomic DB fanout queues exactly one delivery per event and eligible organization, independent of number of staff accounts. New task, released task, another organization claimed, evidence rejected with reason, resolution verified. Disabled organizations do not send. Before the first network attempt, obsolete availability events are cancelled; a newer availability event supersedes older unattempted ones.

Deterministic Russian templates include event time, report ID, category, address, short description, rejection reason when relevant and direct task link. They are notifications, not separate complaints. Untrusted fields are plain text and obvious credentials/URLs/opaque tokens are redacted. No AI generation or secret environment values are included. Links never carry passwords or login tokens. Current authorization is checked when opening the task.

## Confirmation and retries

Only a successful Resend HTTP response with a valid email ID changes status to sent (`provider accepted`, not inbox delivery or recipient read). Fixed provider host, no arbitrary webhooks/redirects. Safe event ID/status/error code logs; no contacts, bodies, provider error strings or secrets in logs.

Frozen payload and stable idempotency key `ayan-notification/<queue UUID>` survive retries and crashes. Serialization has a fixed field order. Row-level leases with fencing prevent stale workers acknowledging jobs. Backoff on 429/5xx/network ambiguity, at most 6 attempts. Resend retains idempotency keys for 24 hours; retries stop after 23 hours from first network attempt. Expired/ambiguous outcomes become uncertain and require checking provider logs before any administrative resend. No reset button can silently create a fresh idempotency key. Changing destination after an attempt is blocked. Definite configuration errors require correction then safe retry; unsupported channels stay blocked.

Exceptions create developer-only in-app notifications. Executors cannot list/change the outbox or retry deliveries. Legacy message API/DB can only edit drafts, not manufacture sent status. No email receipt/webhook/bounce tracking is claimed.

## Verification

`tests/phase5f-database.mjs`: mandatory GPS, RLS, outbox lifecycle, fencing, immutable payload, retry cutoff, public evidence; native PostgreSQL mode additionally checks concurrent queue workers and competing organization claims.
`tests/phase5f-provider.cjs`: actual Resend request contract with mocked HTTP responses, confirmations, transient/permanent failures, idempotency, redaction, worker/reviewer API authorization.
`tests/evidence-capture.cjs`, `tests/evidence-submit-api.cjs`, `tests/review-ui.cjs`, `tests/staff-navigation.cjs`, existing review/image/AI/claim regressions, typecheck/build.

Provider references: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/emails/idempotency-keys .
