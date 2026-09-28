# Phase 5D / 5E

Apply `supabase/migrations/20260928164846_phase5de_evidence_notifications.sql` manually AFTER the Phase 5B/C migration `20260928122500_phase5bc_claims_and_insights.sql`. Existing migrations must not be rerun. No production data backfill or invented location/capture history. Deploy code after SQL.

Existing server-only `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are reused; no new secrets. Missing either leaves evidence awaiting human review. Run the site over HTTPS for camera/geolocation (localhost is also a secure context). Camera/GPS require browser permission; file upload and no-GPS remain available.

## Evidence

Camera uses getUserMedia with no audio. File fallback is marked as a file, not presented as verified camera capture. Before upload, the selected image is rasterized to JPEG (maximum dimension 2400px) to strip EXIF/location. This is an accessibility option, not a hardware-backed authenticity guarantee.

GPS is opt-in, requested once at submission with maximumAge=0 and 10-second timeout. Denial/missing GPS does not block. Exact GPS coordinates are sent transiently to the authenticated server, then to the server-only SQL function for distance calculation; only rounded distance and accuracy are stored, never latitude/longitude or a location track. No coordinates or image payloads are logged or sent to Gemini. Browser camera/time/GPS metadata can be spoofed and are labelled accordingly.

The database initializes every submission with `signals_missing`, even submissions bypassing the API. Server downloads real stored after-photo bytes, checks MIME/size/allowed storage origin, saves evidence through the existing claimant-only RPC, then attempts the private attestation. SHA-256 uses actual downloaded bytes, not client-provided hashes. Original-photo equality and reuse of previously checked after-photo bytes are review flags. Equality checks serialize on a hash advisory lock. Cropped/recompressed images can evade exact equality; the AI comparison and human reviewer remain necessary. No claim that gallery dates prove freshness.

Distance uses original report coordinates. Review flags: GPS older than 2 minutes/missing/invalid, accuracy worse than 100m, distance greater than max(200m,2×accuracy); image time unknown or beyond 15 minutes; upload older than 15 minutes; non-camera source; identical/reused image; missing original. Server-derived claim-to-evidence time under 60 seconds is an attention flag only; legacy unknown claim times remain unknown. No flag rejects, releases or verifies a report.

Actual before/after bytes are sent as two inlineData parts to Gemini through the existing working native HTTPS transport (gemini-2.5-flash). JSON is validated; failures/low confidence (<0.8)/negative or uncertain results require review. Safe diagnostic codes only. AI can never finalize. Private signals additionally force needs_review even if AI is positive. No-AI submissions stay in the normal human review queue. Late AI cannot overwrite human decisions.

Reviewers see private signals beside existing public photos. Rejection requires a 3–1000 character reason in UI, API and DB; the old two-argument RPC still verifies, but cannot reject without a reason. Reason is stored privately in the review audit and notifications, not the public history. Existing verified-final and self-review protections remain.

## Notifications

`/dashboard/notifications`, sidebar unread count; refresh every 30 seconds, on window focus and manual refresh. Per-user read/unread is server controlled. Pagination is 30 items. No browser push, email or WhatsApp.

- New task / accepted AI category routing: eligible active organizations.
- Another organization claimed: other eligible active organizations.
- Evidence submitted: claimant organization and enabled independent reviewers.
- Rejected + reason: performing organization and reviewers.
- Claim released / task available again: eligible organizations and reviewers.
- Verified: performing organization and reviewers.
- AI/trust needs_review: reviewers.

DB triggers create notifications atomically with their events. Internal fanout RPCs are not callable by clients. All new tables have RLS and explicit grants; operators cannot fabricate signals/notifications. Reading requires recipient ID plus current enabled role and matching active organization. Changing organization/disabling staff removes access to old private notifications. Notification links confer no operational privileges; claim authorization remains authoritative. No historical notification backfill.

Tests: `PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/evidence-notifications.mjs`, `node tests/evidence-capture.cjs`, `node tests/evidence-submit-api.cjs`, existing review/image/AI/5BC regressions, `npm run typecheck`, `npm run build`.
