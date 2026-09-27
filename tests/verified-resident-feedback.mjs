// Isolated PostgreSQL integration test. No network or real Supabase connection.
// Install @electric-sql/pglite in /tmp/aqtau-sql-test, then run this file with node.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
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
const op='10000000-0000-4000-8000-000000000001',dev='10000000-0000-4000-8000-000000000002',resident='10000000-0000-4000-8000-000000000003',org='20000000-0000-4000-8000-000000000001',report='30000000-0000-4000-8000-000000000001';
await db.exec(`INSERT INTO auth.users VALUES('${op}'),('${dev}'),('${resident}');
INSERT INTO organizations(id,name,category,channel,destination) VALUES('${org}','isolated','roads','web','isolated');
INSERT INTO operator_profiles(id,is_operator,role,organization_id) VALUES('${op}',true,'operator','${org}'),('${dev}',true,'developer',NULL);
INSERT INTO reports(id,category,description,address,latitude,longitude,organization_id,photo_url) VALUES('${report}','roads','isolated','isolated',43.65,51.15,'${org}','https://example.invalid/before.jpg');`);
const role=async(r,user='')=>db.exec(`RESET ROLE; SET request.jwt.claim.sub='${user}'; SET ROLE ${r};`);
await role('authenticated',op);
await db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op}/${report}/a.jpg')`);
const evidence=(await db.query(`SELECT submit_report_resolution('${report}','isolated repair','${op}/${report}/a.jpg') AS id`)).rows[0].id;
await role('authenticated',dev);await db.exec(`SELECT review_report_resolution('${evidence}','verify')`);
const snapshot=async()=>(await db.query(`SELECT r.status,r.resolved_at,r.photo_url,z.state,z.after_photo_path,z.reviewed_at,(SELECT count(*) FROM report_events WHERE report_id=r.id) AS events FROM reports r JOIN report_resolutions z ON z.report_id=r.id WHERE z.id='${evidence}'`)).rows[0];
const before=await snapshot();assert.equal(before.status,'resolved');assert.equal(before.state,'verified');
for(const [r,user] of [['anon',''],['authenticated',resident]]){
 await role(r,user);
 for(const decision of ['reopen','confirm'])await assert.rejects(db.exec(`SELECT resolution_resident_feedback('${evidence}','40000000-0000-4000-8000-000000000001','${decision}')`),e=>e.code==='42501');
 await assert.rejects(db.exec(`UPDATE report_resolutions SET state='reopened' WHERE id='${evidence}'`),e=>e.code==='42501');
 const directUpdate=()=>db.query(`UPDATE reports SET status='in_progress',resolved_at=NULL WHERE id='${report}' RETURNING id`);
 if(r==='anon')await assert.rejects(directUpdate,e=>e.code==='42501');
 else assert.equal((await directUpdate()).rows.length,0);
 assert.deepEqual(await snapshot(),before); // publicly readable photos/status/history unchanged
}
await db.exec('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int AS n FROM resolution_feedback')).rows[0].n,0);
await role('authenticated',dev);await db.exec(`SELECT review_report_resolution('${evidence}','reopen')`);assert.equal((await snapshot()).status,'in_progress');
await role('authenticated',op);const next=(await db.query(`SELECT submit_report_resolution('${report}','another repair','${op}/${report}/a.jpg') AS id`)).rows[0].id;
await role('anon');await db.exec(`SELECT resolution_resident_feedback('${next}','40000000-0000-4000-8000-000000000002','confirm')`);
await role('authenticated',dev);await db.exec(`SELECT review_report_resolution('${next}','reopen')`);
console.log('PASS: verified resident RPC/direct mutations denied atomically, public evidence/history unchanged, developer reopen/reject and operator evidence/resubmission preserved.');

await db.exec('RESET ROLE; GRANT SELECT,INSERT,UPDATE,DELETE ON organization_messages TO authenticated; GRANT SELECT ON organizations TO authenticated;');
await role('authenticated',dev);
const message=(await db.query(`INSERT INTO organization_messages(report_id,organization_id,direction,channel,destination,body,status) VALUES('${report}','${org}','outbound','web','isolated','isolated','draft') RETURNING id`)).rows[0].id;
await db.exec(`SELECT create_report_event('${report}','message_prepared','Черновик подготовлен',NULL,'developer',NULL,'${org}')`);
assert.equal((await db.query(`UPDATE organization_messages SET body='edited' WHERE id='${message}' RETURNING id`)).rows.length,1);
assert.equal((await db.query(`SELECT id FROM organizations WHERE id='${org}'`)).rows.length,1);
await role('authenticated',op);
assert.equal((await db.query('SELECT * FROM organization_messages')).rows.length,0);
assert.equal((await db.query(`UPDATE organization_messages SET body='forged' WHERE id='${message}' RETURNING id`)).rows.length,0);
assert.equal((await db.query(`DELETE FROM organization_messages WHERE id='${message}' RETURNING id`)).rows.length,0);
await assert.rejects(db.exec(`INSERT INTO organization_messages(report_id,organization_id,direction,channel,destination,body,status) VALUES('${report}','${org}','outbound','web','isolated','forged','draft')`),e=>e.code==='42501');
await assert.rejects(db.exec(`SELECT create_report_event('${report}','message_prepared','forged')`),e=>e.code==='42501');
await db.exec(`SELECT create_report_event('${report}','status_changed','isolated')`);
console.log('PASS: communication RLS/event RPC permits developer and denies executor read/write/delete; executor status workflow remains.');
await db.close();
