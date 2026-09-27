# Aýan — Phase 4A corrective analytics

## Applying the correction

Apply `supabase/migrations/20260926000010_fix_city_intelligence_analytics.sql` once in Supabase SQL Editor after 00009. Do not rerun or edit 00009. The correction replaces analytics functions and adds a private common cohort helper and a category-aware summary RPC. It does not modify tables, records, RLS policies, or Phase 1–3 functions.

## Reproduced 00009 defects

- KPI: SQLSTATE 42702, ambiguous `total_supports` (output parameter vs CTE column); integer literal returned for bigint hotspot count; percentile result requires numeric conversion.
- Hotspots: SQLSTATE 42702, ambiguous output names; coordinate averages and counts do not match declared numeric/integer output types. Grouping only by category incorrectly merges disconnected groups. Random IDs are unstable.
- Heat: SQLSTATE 42883, `round(double precision, integer)` does not exist for the actual reports coordinate types. The PL/pgSQL query also lacks RETURN QUERY and has ambiguous names.
- All-time trend: `created_at >= NULL` excludes every row, while frontend separately replaces NULL with 30 days.
- UI: Promise.all failure is followed by rendering default zeros/empty arrays; only a transient toast indicates failure. The heatmap component is never mounted; the page contains a permanent placeholder. A hook appears after an auth-dependent early return.
- Resolution: historical verification existence can count obsolete reviews and repeat samples. Reopen counting misses resident events. Zero hours is incorrectly treated as missing data.

## Definitions

All panels share the same creation-date cohort and optional category. 7/30/90 are rolling intervals ending now; all time has no lower cutoff. Future-dated records are excluded. Day/week/month grouping uses Asia/Aqtau. Days 7/30 use daily buckets, 90 uses weekly, all time uses weekly up to one year of observed history and monthly beyond. Trend is report creation cohorts and their *current* independently verified status, not a chronology of closure events. Only observed buckets are returned; no synthetic historical incidents.

Active = new or in_progress. Verified = currently resolved and current verified evidence with a matching independent developer review (author differs from reviewer). One duration per report, creation to current verification. Legacy status-only closure is excluded. Reopened = distinct report with a reopen review, evidence timestamp, or resolution_reopened event, including resident feedback. This is a historical signal for the selected cohort, not necessarily currently reopened.

Hotspots = disjoint connected components of valid coordinates within 150m of another same-category member, with at least 3 reports. Chains may span more than 150m end-to-end. Deterministic ID is the smallest member UUID. Each report/support is counted once per component. Heat includes every valid point even without a hotspot.

Heat weight per report = `1 + min(support_count, 5) / 10`, range 1–1.5. Leaflet.heat 0.2.0 combines points on canvas with radius 36px, blur 28px, max 6, maxZoom 14 and minOpacity .22. Blue/cyan gradient; screen/zoom-dependent density, not an absolute geographic rate.

Tiles remain standard OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`). Only the analytics tile layer receives a dark CSS color filter; heat/controls/attribution are not filtered. OpenStreetMap copyright link remains visible. No paid provider/key; public map unchanged.

## Error and access behavior

Page remains operator-only, as in Phase 4A. RPCs validate enabled operator/developer identity internally, rather than assuming every authenticated user is staff. Private report facts helper cannot be called by API roles. No authentication architecture or role assignments changed.

Loading, successful empty result and failure are separate states. On filter changes old results are removed; stale responses are ignored. RPC errors and malformed responses reject the load. UI displays a generic persistent error and retry action. RPC name/code/message are logged only in development; no raw database errors or records displayed to users.

## Verification commands

```sh
npm run typecheck
node --test tests/*.cjs
PGLITE_MODULE=/tmp/aqtau-sql-test/node_modules/@electric-sql/pglite/dist/index.js node tests/analytics-migration.mjs
PGLITE_MODULE=/tmp/aqtau-sql-test/node_modules/@electric-sql/pglite/dist/index.js node tests/independent-review.mjs
PGLITE_MODULE=/tmp/aqtau-sql-test/node_modules/@electric-sql/pglite/dist/index.js node tests/resolution-migration.mjs
npm run build
```

SQL test records exist only in isolated PGlite memory, never in Supabase. Regression tests cover 00009 failure reproduction, actual migration schema, zero/error separation, staff access, categories, periods, verified and reopened semantics, support caps, invalid coordinates, stable separated clusters and isolated points without hotspots.

Read-only production baseline observed during this correction: 15 reports, 13 active, 2 resolved by status, 15 valid coordinates, 8 supports, 1 independent verify decision. These are distinct from proof that corrected RPCs have been applied and verified in production.

## Real-data acceptance completed

User applied 00010 manually during this task. Corrected local production build tested against the same Supabase with operator login. All four periods returned 15 reports/points, 13 active, 1 independent verified, 1 reopened, 1 hotspot. Separate read-only SQL confirmed 15 in each period, 1 reopen and 1.4872 hours to independent verification. Hotspot: 10 manhole reports, 4 supports, 8 active, 1 verified, 0 reopened. Water: 2 points, 1 reopened, no hotspot; garbage: genuine empty result. No real records were created or modified for testing.

Viewport checks: 1440×900, 1920×1080, 768×1024, 390×844. Map is 560px desktop/tablet and 380px mobile. Mobile chart-tooltip overflow found and fixed with chart-container clipping. Error/null/missing RPC response separation tested in client regression; genuine zero-data state verified in browser. Existing tests, analytics client/SQL tests, typecheck and production build passed. Build retains pre-existing Supabase dynamic import/Browserslist warnings.
