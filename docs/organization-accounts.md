# Organization-bound operators (Phase 4B correction)

## Apply in this order

1. Migration 00011 is already applied. Do not edit or rerun it.
2. Run **all** of `supabase/migrations/20260927000012_organization_operator_accounts.sql` manually in Supabase SQL Editor as the administrator. It is transactional. No existing accounts, reports, organizations, evidence or reviews are deleted/recreated/backfilled.
3. Link the existing operator to the correct real organization using the instructions below. No company is guessed. The inspected pre-migration database has one enabled operator needing this backfill and one developer, who needs no backfill.
4. Refresh/sign in on the updated app. An unlinked operator may still authenticate and read city aggregates/public reports, but has no operational queue or mutation permissions and sees an administrator-assignment notice.

The `enabled_staff_organization` CHECK is deliberately `NOT VALID`: it accepts existing unlinked rows, enforces the relationship for new/updated enabled profiles, and can be validated after manual backfill. `organization_id` is a nullable FK with RESTRICT deletion; many profiles may refer to one organization. Enabled developers must have NULL organization_id. Disabled profiles may remain unlinked. Inactive organizations confer no operational access.

## Create/link an account safely

Use Supabase SQL Editor under your administrator account. The following are templates, **not executable until placeholders are replaced**. No passwords belong in SQL, project files or chat.

First list real organizations; reuse an existing one whenever appropriate:

```sql
SELECT id, name, category, active FROM public.organizations ORDER BY name;
```

Only if a real organization is missing, insert its actual details. `category` must be one of roads, lighting, garbage, water, manholes, sidewalks, infrastructure, other. `channel`: whatsapp, telegram, email, api or web. Destination is private operational contact information, not a credential.

```sql
INSERT INTO public.organizations (name, category, channel, destination, active)
VALUES ('ACTUAL_ORGANIZATION_NAME', 'roads', 'web', 'ACTUAL_CONTACT_OR_URL', true)
RETURNING id, name;
```

In **Authentication → Users → Add user → Create new user**, create the organization's employee with email/password in Supabase Auth. Copy the Auth UUID. Do not send the password to anyone. For an existing operator, reuse its existing Auth UUID; do not recreate the account.

Replace both UUID placeholders and run:

```sql
INSERT INTO public.operator_profiles (id, is_operator, role, organization_id)
VALUES ('AUTH_USER_UUID'::uuid, true, 'operator', 'ORGANIZATION_UUID'::uuid)
ON CONFLICT (id) DO UPDATE
SET is_operator=true, role='operator', organization_id=EXCLUDED.organization_id;
```

Repeat with a different Auth UUID and the same organization UUID for another employee. A reviewer is independent:

```sql
INSERT INTO public.operator_profiles (id, is_operator, role, organization_id)
VALUES ('DEVELOPER_AUTH_UUID'::uuid, true, 'developer', NULL)
ON CONFLICT (id) DO UPDATE
SET is_operator=true, role='developer', organization_id=NULL;
```

Check the remaining backfill count, without exposing identities:

```sql
SELECT count(*) AS operators_needing_assignment
FROM public.operator_profiles
WHERE is_operator AND role='operator' AND organization_id IS NULL;
-- Only once the count is zero:
ALTER TABLE public.operator_profiles VALIDATE CONSTRAINT enabled_staff_organization;
```

## Explicit administrator assignment

Multiple active organizations in the same category are supported. Automatic routing assigns only when exactly one active company matches the **stored report category**. Zero/multiple candidates return NULL and the resident report remains saved. Existing assignments are returned unchanged, even when mappings change. No random choice or load balancing.

For ambiguous/unassigned reports, an administrator chooses explicitly:

```sql
UPDATE public.reports SET organization_id='CHOSEN_ORGANIZATION_UUID'::uuid
WHERE id='REPORT_UUID'::uuid;
```

A trigger records a `routed` event on real assignment changes, with the previous/new names and new organization ID. Repeating the same assignment adds no event. No historical assignment is reconstructed or changed. Client roles cannot update the assignment column or insert a report with a forged assignment. Only administrators manage organizations/profiles. No public signup UI was added.

## Authorization and public data

- `operator_organization_id()` resolves the enabled operator's active company from their authenticated UUID, never from request JSON.
- `can_operate_report()` compares it to reports.organization_id.
- Report UPDATE RLS permits only that company; existing column grants still permit only status/resolved_at. Phase 3 verification trigger remains unchanged.
- `submit_report_resolution` locks the report then checks company membership; storage upload policy checks both author and assigned report. The server checks ownership before upload validation or trusted AI analysis.
- Private messages require BOTH the stored message company and the report's current company to match the operator. Reassignment does not transfer old correspondence. APIs use caller JWT/RLS, never the service-role writer.
- Operators cannot change profiles, companies, assignments, reviewer identity, protected review events or supporter tokens. Event creation uses a scoped RPC; actor UUID/company come from the session/database. Assignment history is written by the trigger, not user-submitted events.
- Developer cross-company evidence/review access and the immutable-author self-review prohibition are unchanged. Developers do not need a company and receive no private organization correspondence.
- Reports and public histories remain publicly readable for resident map/detail/duplicate/+1 flows. This is distinct from operational permission. The operational list RPC is scoped on the server; public detail pages only show actionable controls for the assigned operator. Analytics drilldown is likewise scoped. City-level heatmap/systemic/service **aggregates** remain available to staff; other companies' rows cannot open an operational queue.
- No keys, password tables, password hashes, auth architecture replacement, new service credentials, or private data in analytics.

## Leaflet root cause and correction

Browser errors point to Leaflet.heat 0.2.0 `_redraw` accessing `_map.getSize()` after layer removal. The installed plugin schedules RAF in `redraw`, but `onRemove` never cancels it. A synchronous `_reset` calls `_redraw`, which resets `_frame` without cancelling the already queued callback, losing its handle.

`lib/managed-heat-layer.ts` wraps only the analytics layer: it cancels the pending RAF both before synchronous/queued redraw and before removal. No exception is caught/suppressed. Cleanup disconnects the ResizeObserver, clears the live-map reference, stops flight/pan, then removes the map/layers. Observer callbacks only run against their still-current map.

A second actual stack was Leaflet 1.9.4 `_onZoomTransitionEnd` reading a removed map pane. `_animateZoom` schedules a 250ms timeout not tracked/cancelled by `Map.remove`. Analytics uses `zoomAnimation:false` to avoid this detached transition; `flyTo` focus remains available and is stopped during cleanup. Public map is unchanged.

Show all also clears React's selected hotspot ID. Selecting the same hotspot again reruns focus. Heat weights, tiles, thresholds and stable hotspot IDs are unchanged.

## Analytics definitions and UX

Service rows already join **reports.organization_id**, not category mapping. Multiple companies in one category stay separate, alphabetically ordered. Assigned = all assigned reports in the creation-date/category cohort; active = new/in_progress; verified = currently resolved plus current evidence with matching independent verification; reopened = distinct reports with historical reopen (even if later reverified). Verify/reopen decision counts are historical per cohort and may exceed distinct report counts. Percentage = current verified / assigned ×100. Unassigned records enter no company's denominator.

One timing sample per currently verified report, from report creation to latest valid current independent verification. A reopen removes that sample; reverification replaces it, never double-counts cycles. Mean/median need at least 3 valid samples; otherwise “Недостаточно данных”. Actual reassignment changes which company's current-assignment totals contain a report; this is not historical staff attribution.

Systemic rule from 00011: same-category connected component with >=3 reports and pairwise neighbor edges <=150m, plus span>=7d OR a reopened report OR nearby new report after another report's independent verification OR an active report open >=14d since creation/latest reopen. Chains may exceed 150m end-to-end; no claim of a single encompassing radius. Post-verification recurrence additionally requires direct <=150m distance and later creation time. +1 support never classifies alone. Responsible company shown only when every member has the same non-NULL assignment. Named thresholds live in `city_intelligence_4b_config`.

Primary copy now explains repeating/returning problems in plain Russian. Empty: “Системных проблем пока не выявлено.” Threshold/denominator detail is disclosed separately. Cards explain concrete observations. Unassigned reports get a small separate note. No scores, rankings, predictions or Phase 5 work.

## Verification

Targeted tests: `tests/organization-accounts-migration.mjs`, `tests/managed-heat-layer.cjs`, `tests/organization-api.cjs`, plus Phase 4B client/SQL tests and all existing Phase 3/4A tests. SQL test records exist only in in-memory PGlite, never real Supabase.

Manual acceptance after migration/backfill: operator login/name, /dashboard and /dashboard/reports own queue; чужой UUID has no operational controls; /dashboard/analytics periods/categories, repeated focus/reset and remount; systemic empty/details; service denominator and low samples; organization drilldown; /dashboard/review forbidden for operators; developer login and cross-company review queue. Do not create real reports or change real review outcomes solely for testing.


Real-data baseline before 00012: 15 reports, 12 unassigned, two organizations with actual assignments (1 and 2 reports). Neither assigned group currently has an independent verified resolution; service timing honestly shows insufficient data. The city total has one independently verified resolution, on an unassigned report, so it correctly contributes to no service row. Zero systemic issues currently qualify. Browser outputs of applied 00011 agree with separately queried assignment counts. No real reports, evidence, outcomes or messages were created/changed for testing.
