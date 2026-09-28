// Isolated PostgreSQL integration test. No network or real Supabase connection.
// Install @electric-sql/pglite in /tmp/aqtau-sql-test, then run this file with node.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
let db;
if(process.env.CLAIM_TEST_DATABASE_URL){
 const {Client}=(await import(process.env.PG_MODULE)).default;const client=new Client({connectionString:process.env.CLAIM_TEST_DATABASE_URL});await client.connect();
 db={exec:s=>client.query(s),query:(s,p)=>client.query(s,p),close:()=>client.end()};
}else db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,created_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
GRANT SELECT,INSERT ON storage.objects TO anon,authenticated;`);
for(const name of ['20260923214917_create_reports_table.sql','20260925000000_add_operator_auth.sql','20260925000001_add_organizations_and_communication.sql']) {
 let sql=readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
 // Omit demo seed records from the original migration; use isolated test fixtures only.
 if(name.startsWith('202609232')) sql=sql.slice(0,sql.indexOf('-- 5. SEED DATA'));
 await db.exec(sql);
}
await db.exec(`GRANT SELECT,INSERT,UPDATE ON public.reports TO anon,authenticated;
GRANT SELECT ON public.operator_profiles TO authenticated;
GRANT SELECT ON public.report_events TO anon,authenticated;`);
await db.exec(readFileSync(new URL('../supabase/migrations/20260926000007_resolution_verification.sql',import.meta.url),'utf8'));

await db.exec(readFileSync(new URL('../supabase/migrations/20260926000004_add_report_supports.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20260926000008_independent_resolution_review.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20260926000009_city_intelligence_analytics.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20260926000010_fix_city_intelligence_analytics.sql',import.meta.url),'utf8'));

await db.exec(readFileSync(new URL('../supabase/migrations/20260926000011_systemic_issues_service_performance.sql',import.meta.url),'utf8'));


for(const migration of ['20260927000012_organization_operator_accounts.sql','20260928000013_close_verified_resident_feedback.sql','20260928000014_ayan_operator_communication.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20260928000015_smart_category_discovery.sql',import.meta.url),'utf8'));

const op='10000000-0000-4000-8000-000000000001',op2='10000000-0000-4000-8000-000000000002',dev='10000000-0000-4000-8000-000000000003',outsider='10000000-0000-4000-8000-000000000004';
const org='20000000-0000-4000-8000-000000000001',org2='20000000-0000-4000-8000-000000000002',org3='20000000-0000-4000-8000-000000000003';
const legacy='30000000-0000-4000-8000-000000000001',task='30000000-0000-4000-8000-000000000002',race='30000000-0000-4000-8000-000000000003';
await db.exec(`INSERT INTO auth.users VALUES('${op}'),('${op2}'),('${dev}'),('${outsider}');
INSERT INTO organizations(id,name,category,channel,destination) VALUES('${org}','A','roads','web','isolated'),('${org2}','B','roads','web','isolated'),('${org3}','C','water','web','isolated');
INSERT INTO operator_profiles(id,is_operator,role,organization_id) VALUES('${op}',true,'operator','${org}'),('${op2}',true,'operator','${org2}'),('${dev}',true,'developer',NULL),('${outsider}',true,'operator','${org3}');
INSERT INTO reports(id,category,description,address,latitude,longitude,organization_id) VALUES('${legacy}','roads','legacy','isolated',43.65,51.15,'${org}'),('${task}','roads','new','isolated',43.65,51.15,NULL),('${race}','roads','race','isolated',43.65,51.15,NULL);`);
const before=(await db.query(`SELECT organization_id,status,created_at FROM reports WHERE id='${legacy}'`)).rows;
await db.exec(readFileSync(new URL('../supabase/migrations/20260928122500_phase5bc_claims_and_insights.sql',import.meta.url),'utf8'));
assert.deepEqual((await db.query(`SELECT organization_id,status,created_at FROM reports WHERE id='${legacy}'`)).rows,before);
assert.equal((await db.query(`SELECT claimed_at FROM report_claims WHERE report_id='${legacy}'`)).rows[0].claimed_at,null);

await db.exec(readFileSync(new URL('../supabase/migrations/20260928164846_phase5de_evidence_notifications.sql',import.meta.url),'utf8'));
const role=(r,u='')=>db.exec(`RESET ROLE; SET request.jwt.claim.sub='${u}'; SET request.jwt.claim.role='${r}'; SET ROLE ${r};`);
const scalar=async(sql)=>(await db.query(sql)).rows[0].value;
assert.deepEqual((await db.query(`SELECT organization_id,status,created_at FROM reports WHERE id='${legacy}'`)).rows,before);
assert.equal(Number(await scalar('SELECT count(*) AS value FROM staff_notifications')),0);
const task2='30000000-0000-4000-8000-000000000010';
await role('anon');await db.exec(`INSERT INTO reports(id,category,description,address,latitude,longitude) VALUES('${task2}','roads','isolated','isolated',43.65,51.15)`);
await assert.rejects(db.exec('SELECT * FROM staff_notifications'),e=>e.code==='42501');
await assert.rejects(db.exec('SELECT * FROM resolution_trust'),e=>e.code==='42501');
for(const u of [op,op2]){await role('authenticated',u);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE report_id='${task2}' AND event_type='task_available'`)),1);}
await role('authenticated',outsider);assert.equal(Number(await scalar('SELECT count(*) AS value FROM staff_notifications')),0);
await role('authenticated',dev);assert.equal(Number(await scalar('SELECT count(*) AS value FROM staff_notifications')),0);
await role('authenticated',op);await db.exec(`SELECT claim_report('${task2}')`);
await role('authenticated',op2);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE event_type='claimed_elsewhere'`)),1);
await assert.rejects(db.exec(`SELECT submit_report_resolution('${task2}','wrong organization','x')`),e=>e.code==='42501');
await role('authenticated',op);await db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op}/${task2}/a.jpg')`);
const ev=await scalar(`SELECT submit_report_resolution('${task2}','repair done','${op}/${task2}/a.jpg') AS value`);
assert.equal((await scalar(`SELECT flags AS value FROM resolution_trust WHERE resolution_id='${ev}'`))[0],'signals_missing');
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE event_type='evidence_submitted'`)),1);
await assert.rejects(db.exec(`UPDATE resolution_trust SET flags='{}' WHERE resolution_id='${ev}'`),e=>e.code==='42501');
await assert.rejects(db.exec(`SELECT record_resolution_trust('${ev}','{}','${'a'.repeat(64)}',NULL)`),e=>e.code==='42501');
await assert.rejects(db.exec(`SELECT notify_staff('${task2}','task_available','forged','forged',NULL,NULL,true,true,NULL)`),e=>e.code==='42501');
await role('authenticated',op2);assert.equal(Number(await scalar('SELECT count(*) AS value FROM resolution_trust')),0);
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE event_type='evidence_submitted'`)),0);
await role('service_role');
await db.query(`SELECT record_resolution_trust($1,$2::jsonb,$3,$4)`,[ev,JSON.stringify({source:'camera',photoTime:Date.now(),gps:{latitude:43.65,longitude:51.15,accuracy:12,timestamp:Date.now()}}),'a'.repeat(64),'b'.repeat(64)]);
await db.exec(`SELECT record_resolution_ai('${ev}','{"likely_resolved":true,"confidence":0.95,"requires_human_review":false,"observations":[]}'::jsonb)`);
await role('authenticated',dev);
const trust=(await db.query(`SELECT * FROM resolution_trust WHERE resolution_id='${ev}'`)).rows[0];
assert.equal(trust.distance_m,0);assert.equal(trust.accuracy_m,12);assert.ok(trust.flags.includes('short_work_time'));
assert.equal(trust.photo_source,'camera');assert.equal(trust.ai_status,'available');assert.equal('latitude' in trust,false);
assert.equal(await scalar(`SELECT state AS value FROM report_resolutions WHERE id='${ev}'`),'needs_review');
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE event_type='review_exception'`)),1);
// A reason is mandatory even for a crafted direct RPC, but a reviewer may verify fast work.
await assert.rejects(db.exec(`SELECT review_report_resolution('${ev}','reopen')`),e=>e.code==='22023');
await db.exec(`SELECT review_report_resolution('${ev}','reopen','Фото не показывает результат ремонта')`);
await role('authenticated',op);assert.equal(await scalar(`SELECT body AS value FROM staff_notifications WHERE event_type='evidence_rejected'`),'Фото не показывает результат ремонта');
await role('authenticated',op2);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE event_type='evidence_rejected'`)),0);
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE event_type='claim_released'`)),1);
assert.equal(await scalar(`SELECT can_claim_report('${task2}') AS value`),true);
const own=await scalar(`SELECT id AS value FROM staff_notifications WHERE event_type='claim_released'`);
await db.exec(`SELECT set_notification_read('${own}',true)`);assert.ok(await scalar(`SELECT read_at AS value FROM staff_notifications WHERE id='${own}'`));
await role('authenticated',op);await assert.rejects(db.exec(`SELECT set_notification_read('${own}',false)`),e=>e.code==='42501');
await role('authenticated',op2);await db.exec(`SELECT set_notification_read('${own}',false)`);assert.equal(await scalar(`SELECT read_at AS value FROM staff_notifications WHERE id='${own}'`),null);
await assert.rejects(db.exec(`UPDATE staff_notifications SET title='forged' WHERE id='${own}'`),e=>e.code==='42501');
await db.exec(`SELECT claim_report('${task2}'); INSERT INTO storage.objects(bucket_id,name,created_at) VALUES('resolution-images','${op2}/${task2}/b.jpg',now()-interval '1 day')`);
const ev2=await scalar(`SELECT submit_report_resolution('${task2}','second repair','${op2}/${task2}/b.jpg') AS value`);
await role('service_role');await db.query(`SELECT record_resolution_trust($1,$2::jsonb,$3,$4)`,[ev2,JSON.stringify({source:'file',photoTime:Date.now()-86400000,gps:{latitude:44,longitude:52,accuracy:2000,timestamp:Date.now()}}),'a'.repeat(64),'a'.repeat(64)]);
await db.exec(`SELECT record_resolution_ai('${ev2}','{"likely_resolved":false,"confidence":0,"requires_human_review":true,"observations":[]}'::jsonb)`);
await role('authenticated',dev);
const t2=(await db.query(`SELECT * FROM resolution_trust WHERE resolution_id='${ev2}'`)).rows[0];
for(const f of ['camera_not_used','photo_time_unknown_or_old','upload_not_fresh','photo_reused','same_as_before','gps_far','gps_imprecise'])assert.ok(t2.flags.includes(f),f);
assert.equal(t2.ai_status,'unavailable');
await db.exec(`SELECT review_report_resolution('${ev2}','verify')`);
await assert.rejects(db.exec(`SELECT review_report_resolution('${ev2}','reopen','cannot undo final')`),e=>e.code==='42501');
await role('authenticated',op2);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE event_type='resolution_verified'`)),1);
await role('authenticated',op);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE event_type='resolution_verified'`)),0);
// Existing legacy claim, missing/invalid GPS, old client RPC: evidence still saved for manual review.
await db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op}/${legacy}/c.jpg')`);
const ev3=await scalar(`SELECT submit_report_resolution('${legacy}','legacy repair','${op}/${legacy}/c.jpg') AS value`);
await role('service_role');await db.query(`SELECT record_resolution_trust($1,$2::jsonb,$3,NULL)`,[ev3,JSON.stringify({gps:{latitude:999,longitude:0,accuracy:1,timestamp:Date.now()},photoTime:'invalid'}),'c'.repeat(64)]);
await role('authenticated',dev);const t3=(await db.query(`SELECT * FROM resolution_trust WHERE resolution_id='${ev3}'`)).rows[0];
for(const f of ['claim_time_unknown','gps_missing_or_stale','photo_time_unknown_or_old','before_unavailable'])assert.ok(t3.flags.includes(f),f);
assert.equal(t3.distance_m,null);
// A normal five-minute repair near the report has no flags; AI still cannot finalize it.
await role('authenticated',op);await db.exec(`SELECT claim_report('${task}')`);
await role('postgres');await db.exec(`UPDATE report_claims SET claimed_at=now()-interval '5 minutes' WHERE report_id='${task}';UPDATE reports SET claimed_at=now()-interval '5 minutes' WHERE id='${task}'`);
await role('authenticated',op);await db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op}/${task}/clean.jpg')`);
const clean=await scalar(`SELECT submit_report_resolution('${task}','normal repair','${op}/${task}/clean.jpg') AS value`);
await role('service_role');await db.query(`SELECT record_resolution_trust($1,$2::jsonb,$3,$4)`,[clean,JSON.stringify({source:'camera',photoTime:Date.now(),gps:{latitude:43.65,longitude:51.15,accuracy:15,timestamp:Date.now()}}),'d'.repeat(64),'e'.repeat(64)]);
await db.exec(`SELECT record_resolution_ai('${clean}','{"likely_resolved":true,"confidence":0.95,"requires_human_review":false,"observations":[]}'::jsonb)`);
await role('authenticated',dev);assert.deepEqual(await scalar(`SELECT flags AS value FROM resolution_trust WHERE resolution_id='${clean}'`),[]);
assert.equal(await scalar(`SELECT state AS value FROM report_resolutions WHERE id='${clean}'`),'ai_checked');
assert.equal(await scalar(`SELECT status AS value FROM reports WHERE id='${task}'`),'in_progress');
await db.exec(`SELECT review_report_resolution('${clean}','verify')`);
await role('service_role');await db.exec(`SELECT record_resolution_ai('${clean}','{"likely_resolved":false,"confidence":0.1,"requires_human_review":true,"observations":[]}'::jsonb)`);
await role('authenticated',dev);assert.equal(await scalar(`SELECT state AS value FROM report_resolutions WHERE id='${clean}'`),'verified');
await role('anon');await assert.rejects(db.exec(`SELECT resolution_resident_feedback('${clean}','40000000-0000-4000-8000-000000000001','reopen')`),e=>e.code==='42501');
// Phase 5A changes availability, not ownership; category notifications are deduplicated.
const other='30000000-0000-4000-8000-000000000020';
await role('anon');await db.exec(`INSERT INTO reports(id,category,description,address,latitude,longitude,photo_url) VALUES('${other}','other','isolated other','isolated',43.65,51.15,'https://example.invalid/a.jpg')`);
await role('authenticated',op);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE report_id='${other}'`)),0);
await role('service_role');await db.exec(`SELECT claim_category_discovery('${other}');SELECT finish_category_discovery('${other}','{"matches_existing_category":true,"existing_category":"roads","suggested_new_category":null,"confidence":0.95,"reason":"isolated test"}'::jsonb);`);
await role('authenticated',op);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE report_id='${other}' AND event_type='task_available'`)),1);
assert.equal(await scalar(`SELECT organization_id AS value FROM reports WHERE id='${other}'`),null);
await role('postgres');await db.exec(`UPDATE category_discoveries SET category_key=category_key WHERE report_id='${other}'`);
await role('authenticated',op);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE report_id='${other}'`)),1);
// Snapshot scoping: changing organization or disabling a profile removes access to old private notices.
await role('postgres');await db.exec(`UPDATE operator_profiles SET organization_id='${org3}' WHERE id='${op2}'`);
await role('authenticated',op2);assert.equal(Number(await scalar('SELECT count(*) AS value FROM staff_notifications')),0);assert.equal(Number(await scalar('SELECT count(*) AS value FROM resolution_trust')),0);
await role('postgres');await db.exec(`UPDATE operator_profiles SET is_operator=false WHERE id='${dev}'`);
await role('authenticated',dev);assert.equal(Number(await scalar('SELECT count(*) AS value FROM staff_notifications')),0);
await role('anon');assert.equal(Number(await scalar(`SELECT count(*) AS value FROM reports WHERE id='${task2}'`)),1);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM report_resolutions WHERE report_id='${task2}'`)),2);
// Notifications roll back with their originating operation.
await role('postgres');const count=Number(await scalar('SELECT count(*) AS value FROM staff_notifications'));
await db.exec(`BEGIN;INSERT INTO reports(category,description,address,latitude,longitude) VALUES('roads','rollback','isolated',43,51);ROLLBACK;`);
assert.equal(Number(await scalar('SELECT count(*) AS value FROM staff_notifications')),count);
console.log('PASS: fresh/far/imprecise/missing GPS; fast and legacy times; old/reused images; AI fallback; no automatic rejection; independent human review; all six notification events; recipient RLS/read state/org transfer/disabled profiles; public evidence; rollback; no data backfill.');
await db.close();
