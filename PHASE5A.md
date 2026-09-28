# Phase 5A — Smart Category Discovery

Apply `supabase/migrations/20260928000015_smart_category_discovery.sql` once, after migrations 00001–00014. This migration creates a private discovery audit and category catalog; it does not rewrite existing reports. It replaces the organizations category CHECK with a catalog foreign key so an administrator can use approved categories. Existing organization selection rules are unchanged.

Server environment: existing `GEMINI_API_KEY`, plus `SUPABASE_SERVICE_ROLE_KEY` for protected discovery storage. Neither key may have a `NEXT_PUBLIC_` prefix. The usual public Supabase URL/anon key remain unchanged. Missing credentials or an unapplied migration leave submitted reports saved as `other`.

The new-report form calls a dedicated POST only after successfully saving an `other` report. Viewing a report never invokes AI. Only reports created within five minutes, with a photo, can be atomically claimed once. The server reads the stored description/photo URL, downloads actual image bytes from this project's report-images bucket (no redirects, JPEG/PNG/WebP, maximum 10 MB), then sends description + base64 inlineData to Gemini 2.5 Flash using the existing Gemini key and a Phase-5A-only native HTTPS transport. No external image URL is passed as a substitute for bytes. Network/model/schema failures fail closed.

At confidence >= 0.85 a supported existing category can route to exactly one active organization. Original reports.category stays `other`; reports.ai_category and category_discoveries retain the decision/audit. Existing assignments are never replaced. Lower confidence does not classify or route. A confident new category enters the private pending queue; AI cannot insert catalog rows.

Developer (Оператор Aýan) opens `/dashboard/categories` → Новые категории. Each card shows the original photo/description, suggested name, reason and confidence. Accept creates/enables a category, or explicitly merges into an existing category; Reject records the decision without changing the report. All review operations require developer authorization in both API and database. Exact normalized names and common word-ending/order variants reuse a category; semantic synonyms require the human reviewer to select an existing category. Review decisions are serialized and audited. No approximate global suggestion count is shown.

Approved categories join the AI/routing catalog. The existing resident selector, public map filters, analytics and role architecture are unchanged. New categories do not manufacture an organization: matching/assignment still requires one active organization maintained by an administrator.

Focused checks:
- `node tests/category-discovery.cjs` (mock Gemini verifies exact image bytes, validation, safe failure, API authorization)
- `PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/category-discovery.mjs` (isolated PostgreSQL, no production connection)
- `node tests/organization-api.cjs`
- `npm run typecheck` and `npm run build`

No real reports or photos are submitted to Gemini by these tests. Live AI verification requires the migration, server credentials and a deliberate new report submission.

## Diagnosing a failed classification

The POST now returns HTTP 503 with `classification: unavailable` if discovery fails; this does not undo report submission. Server logs tagged `[category_discovery]` identify report UUID, stage, safe error code and HTTP status. SDK messages, photos, descriptions, response bodies and credentials are never logged. A noneligible/already-claimed report returns `classification: skipped`; no retry is performed.

Live diagnosis on 2026-09-28: both resident test discoveries exist as `failed`. Service-role reads and the stored JPEG download succeeded. Gemini rejected a request using that JPEG with HTTP 401; a separate models-access check returned `UNAUTHENTICATED / ACCESS_TOKEN_TYPE_UNSUPPORTED`. The user replaced the Gemini credential; model access and generation then succeeded. Node fetch additionally stalled uploading inline images, while native HTTPS sent the same JPEG successfully in about 2.3 seconds. Phase 5A now uses native HTTPS with a 35-second deadline, bounded responses and the unchanged structured result validation. Full read-only classification of both stored snapshots succeeded: road sign → roads (0.90), broken manhole → manholes (1.00). Both are existing categories, so neither should appear in the pending-new-category queue. Restart the server to load the updated key/code; hosted deployments require their own updated environment and redeployment. Migration 00015 is present and does not need to be reapplied.

These two failed discoveries remain untouched. The public POST cannot retry them after the original claim/window. Do not delete discovery rows, reset creation times or relax eligibility. Recovery, if requested after credentials work, requires a separately authorized administrator operation on the original snapshots, with a recorded recovery decision; no public retry endpoint is added here.

## Anonymous My Reports

`lib/anonymous-history.ts` maintains a separate cryptographically random browser UUID and per-report creation receipts in localStorage. Only successful INSERT return values are remembered; failures do not create receipts. `lib/my-reports.ts` queries public reports by those IDs in bounded batches. It never falls back to fetching all reports. This is a browser-local history association, not a database identity or proof of legal authorship; neither this token nor these receipts authorize any mutation. No IP/location/fingerprinting or supporter-token reuse occurs.

Old reports have no reliable receipt and are not assigned to a browser retrospectively. Another browser starts empty. Clearing browser data loses the history; blocked storage falls back to the current page session without failing report submission. Public report visibility, the map and all existing authorization remain unchanged. No new migration is needed.
