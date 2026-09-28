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
const role=(r,u='')=>db.exec(`RESET ROLE; SET request.jwt.claim.sub='${u}'; SET ROLE ${r};`);
const scalar=async(sql)=>(await db.query(sql)).rows[0].value;
for(const [r,u] of [['anon',''],['authenticated',dev],['authenticated',outsider]]){
 await role(r,u);await assert.rejects(db.exec(`SELECT claim_report('${task}')`),e=>e.code==='42501');
}
await role('anon');assert.equal(Number(await scalar('SELECT count(*) AS value FROM reports')),3);
await assert.rejects(db.exec(`INSERT INTO reports(category,description,address,latitude,longitude,claimed_at) VALUES('roads','forged','isolated',43,51,now())`),e=>e.code==='42501');
for(const u of [op,op2]){await role('authenticated',u);assert.equal(await scalar(`SELECT can_claim_report('${task}') AS value`),true);assert.ok((await db.query('SELECT id FROM get_operational_reports()')).rows.some(r=>r.id===task));await assert.rejects(db.exec(`SELECT submit_report_resolution('${task}','repair note','x')`),e=>e.code==='42501');}
await role('authenticated',op);await db.exec(`SELECT claim_report('${task}'); SELECT claim_report('${task}')`);
assert.equal(await scalar(`SELECT can_operate_report('${task}') AS value`),true);
await role('authenticated',op2);await assert.rejects(db.exec(`SELECT claim_report('${task}')`),e=>e.code==='40001');assert.equal(await scalar(`SELECT can_operate_report('${task}') AS value`),false);
assert.equal((await db.query(`UPDATE reports SET status='new' WHERE id='${task}' RETURNING id`)).rows.length,0);
await assert.rejects(db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op2}/${task}/bad.jpg')`),e=>e.code==='42501');
await role('authenticated',op);await db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op}/${task}/a.jpg')`);
const evidence=await scalar(`SELECT submit_report_resolution('${task}','repair attempt','${op}/${task}/a.jpg') AS value`);
await role('authenticated',dev);await db.exec(`SELECT review_report_resolution('${evidence}','reopen')`);
assert.equal(await scalar(`SELECT organization_id FROM reports WHERE id='${task}'`.replace('SELECT organization_id','SELECT organization_id AS value')),null);
await role('authenticated',op2);assert.equal(await scalar(`SELECT can_claim_report('${task}') AS value`),true);await db.exec(`SELECT claim_report('${task}')`);
await role('authenticated',op);assert.equal(await scalar(`SELECT can_operate_report('${task}') AS value`),false);
await role('authenticated',op2);await db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op2}/${task}/b.jpg')`);
const evidence2=await scalar(`SELECT submit_report_resolution('${task}','second repair','${op2}/${task}/b.jpg') AS value`);
await role('authenticated',dev);await db.exec(`SELECT review_report_resolution('${evidence2}','verify')`);
await assert.rejects(db.exec(`SELECT review_report_resolution('${evidence2}','reopen')`),e=>e.code==='42501');
const perf=await scalar('SELECT get_service_performance(NULL,NULL) AS value');
const a=perf.organizations.find(o=>o.organization_id===org),b=perf.organizations.find(o=>o.organization_id===org2);
assert.equal(Number(a.reopen_decisions),1);assert.equal(Number(a.verified_count),0);assert.equal(Number(b.verification_decisions),1);assert.equal(Number(b.verified_count),1);assert.equal(Number(perf.unassigned_count),1);
await role('anon');await assert.rejects(db.exec(`SELECT resolution_resident_feedback('${evidence2}','40000000-0000-4000-8000-000000000001','reopen')`),e=>e.code==='42501');
await role('authenticated',op2);await assert.rejects(db.exec(`SELECT claim_report('${task}')`),e=>e.code==='22023');
await role('postgres');assert.equal(Number(await scalar(`SELECT count(*) AS value FROM report_claims WHERE report_id='${task}' AND released_at IS NULL`)),1);
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM report_events WHERE report_id='${task}' AND event_type='organization_claimed'`)),2);
// Preserve Phase 5A: trusted category changes eligibility, never auto-claims.
const other='30000000-0000-4000-8000-000000000004',spoof='30000000-0000-4000-8000-000000000005';
await role('anon');await db.exec(`INSERT INTO reports(id,category,description,address,latitude,longitude,photo_url,ai_category) VALUES('${other}','other','test other','isolated',43.6,51.1,'https://example.invalid/a.jpg',NULL),('${spoof}','other','spoof category','isolated',43.6,51.1,NULL,'roads');`);
await role('authenticated',op);assert.equal(await scalar(`SELECT can_claim_report('${spoof}') AS value`),false);
await role('service_role');await db.exec(`SELECT claim_category_discovery('${other}');SELECT finish_category_discovery('${other}','{"matches_existing_category":true,"existing_category":"roads","suggested_new_category":null,"confidence":0.95,"reason":"isolated test"}'::jsonb);`);
await role('authenticated',op2);assert.equal(await scalar(`SELECT can_claim_report('${other}') AS value`),true);
assert.equal(await scalar(`SELECT organization_id AS value FROM reports WHERE id='${other}'`),null);
await role('anon');assert.equal(await scalar(`SELECT assign_report_organization('${other}') AS value`),null);
await role('postgres');
// Native PostgreSQL two-session contention, not a serial mock.
if(process.env.CLAIM_TEST_DATABASE_URL){
 const {Client}=(await import(process.env.PG_MODULE)).default;const ca=new Client({connectionString:process.env.CLAIM_TEST_DATABASE_URL}),cb=new Client({connectionString:process.env.CLAIM_TEST_DATABASE_URL});await ca.connect();await cb.connect();
 await ca.query(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${op}'; SELECT claim_report('${race}')`);
 await cb.query(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${op2}'`);
 const pid=(await cb.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 let done=false;const contender=cb.query(`SELECT claim_report('${race}')`).then(()=>({winner:true}),e=>({code:e.code})).finally(()=>done=true);
 let blocked=false;for(let i=0;i<50;i++){const q=await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);if(q.rows[0]?.wait_event_type==='Lock'){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
 assert.equal(blocked,true);assert.equal(done,false);await ca.query('COMMIT');assert.equal((await contender).code,'40001');await cb.query('ROLLBACK');await ca.end();await cb.end();
 assert.equal(Number(await scalar(`SELECT count(*) AS value FROM report_claims WHERE report_id='${race}' AND released_at IS NULL`)),1);
 console.log('PASS: real concurrent PostgreSQL sessions block on report lock; exactly one winner and one 409-equivalent loser.');
}
console.log('PASS: eligible organizations, legacy preservation, claim-only evidence/storage/status, release/reclaim, immutable attribution, final verification, unclaimed exclusion and public visibility.');
await db.close();
