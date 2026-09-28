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

await db.exec(readFileSync(new URL('../supabase/migrations/20260928175531_phase5f_delivery_and_required_gps.sql',import.meta.url),'utf8'));
const role=(r,u='')=>db.exec(`RESET ROLE; SET request.jwt.claim.sub='${u}'; SET request.jwt.claim.role='${r}'; SET ROLE ${r};`);
const scalar=async(sql)=>(await db.query(sql)).rows[0].value;
const gps=(extra={})=>JSON.stringify({source:'camera',photoTime:Date.now(),gps:{latitude:43.65,longitude:51.15,accuracy:1500,timestamp:Date.now(),...extra}});
assert.deepEqual((await db.query(`SELECT organization_id,status,created_at FROM reports WHERE id='${legacy}'`)).rows,before);
await db.exec(`UPDATE organizations SET channel='email',destination='test@example.invalid' WHERE id='${org}';UPDATE organizations SET channel='whatsapp' WHERE id='${org2}'`);
const newReport='30000000-0000-4000-8000-000000000010';
await role('anon');await db.exec(`INSERT INTO reports(id,category,description,address,latitude,longitude) VALUES('${newReport}','roads','test only','isolated',43.65,51.15)`);
await assert.rejects(db.exec('SELECT ai_result FROM report_resolutions'),e=>e.code==='42501');
await assert.rejects(db.exec('SELECT * FROM external_notifications'),e=>e.code==='42501');
await role('authenticated',op);assert.equal(Number(await scalar('SELECT count(*) AS value FROM external_notifications')),0);
await assert.rejects(db.exec('SELECT * FROM developer_resolution_rows()'),e=>e.code==='42501');
await assert.rejects(db.exec('SELECT * FROM claim_external_notification()'),e=>e.code==='42501');
await role('authenticated',dev);assert.equal(Number(await scalar(`SELECT count(*) AS value FROM external_notifications WHERE event_type='task_available'`)),2);
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM external_notifications WHERE status='blocked' AND last_code='UNSUPPORTED_CHANNEL'`)),1);
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM staff_notifications WHERE event_type='delivery_exception'`)),1);
await role('authenticated',op2);await db.exec(`SELECT claim_report('${newReport}');INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op2}/${newReport}/a.jpg')`);
await assert.rejects(db.exec(`SELECT submit_report_resolution('${newReport}','repair done','${op2}/${newReport}/a.jpg')`),e=>e.code==='22023');
for(const data of ['{}',gps({timestamp:Date.now()-130000}),gps({timestamp:Date.now()+60000}),gps({latitude:91}),gps({accuracy:-1})]){
 await assert.rejects(db.query('SELECT submit_report_resolution($1,$2,$3,$4::jsonb)',[newReport,'repair done',`${op2}/${newReport}/a.jpg`,data]),e=>e.code==='22023');
}
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM report_resolutions WHERE report_id='${newReport}'`)),0);
const ev=(await db.query('SELECT submit_report_resolution($1,$2,$3,$4::jsonb) AS value',[newReport,'repair done',`${op2}/${newReport}/a.jpg`,gps()])).rows[0].value;
assert.equal(Number(await scalar('SELECT count(*) AS value FROM resolution_trust')),0);
await assert.rejects(db.exec(`SELECT ai_result FROM report_resolutions WHERE id='${ev}'`),e=>e.code==='42501');
await role('authenticated',dev);const trust=(await db.query(`SELECT * FROM resolution_trust WHERE resolution_id='${ev}'`)).rows[0];
assert.equal(trust.distance_m,0);assert.equal(trust.accuracy_m,1500);assert(!('latitude' in trust));assert(trust.flags.includes('gps_imprecise'));
assert.equal(Number(await scalar('SELECT count(*) AS value FROM developer_resolution_rows()')),1);
await role('service_role');await db.exec(`SELECT record_resolution_ai('${ev}','{"likely_resolved":true,"confidence":0.95,"requires_human_review":false,"observations":["private reviewer analysis"]}'::jsonb)`);
await role('authenticated',dev);assert.equal((await scalar(`SELECT ai_result AS value FROM developer_resolution_rows() WHERE id='${ev}'`)).confidence,0.95);
// Claim messages are durable, pending availability is skipped once another organization owns the task.
await role('service_role');let job=(await db.query('SELECT * FROM claim_external_notification()')).rows[0];
assert.equal(job.event_type,'claimed_elsewhere');assert.equal(job.organization_id,org);
const payload={from:'sender@example.invalid',to:['test@example.invalid'],subject:'test',text:'immutable test'};
await assert.rejects(db.query(`SELECT finish_external_notification($1,$2,'sent','PROVIDER_ACCEPTED',NULL)`,[job.id,job.lease_token]));
await db.query('SELECT begin_external_attempt($1,$2,$3)',[job.id,job.lease_token,JSON.stringify(payload)]);
await assert.rejects(db.query('SELECT begin_external_attempt($1,$2,$3)',[job.id,job.lease_token,JSON.stringify({...payload,text:'changed'})]));
await db.query(`SELECT finish_external_notification($1,$2,'retry','PROVIDER_OUTCOME_UNKNOWN',NULL)`,[job.id,job.lease_token]);
const originalId=job.id,oldLease=job.lease_token;
await role('postgres');await db.exec(`UPDATE external_notifications SET next_attempt_at=now()-interval '1 minute' WHERE id='${job.id}'`);
await role('service_role');job=(await db.query('SELECT * FROM claim_external_notification()')).rows[0];assert.equal(job.id,originalId);assert.notEqual(job.lease_token,oldLease);assert.deepEqual(job.request_payload,payload);
await assert.rejects(db.query(`SELECT finish_external_notification($1,$2,'sent','PROVIDER_ACCEPTED','11111111-1111-4111-8111-111111111111')`,[job.id,oldLease]),e=>e.code==='42501');
await db.query('SELECT begin_external_attempt($1,$2,$3)',[job.id,job.lease_token,JSON.stringify(payload)]);
await db.query(`SELECT finish_external_notification($1,$2,'sent','PROVIDER_ACCEPTED','11111111-1111-4111-8111-111111111111')`,[job.id,job.lease_token]);
assert.equal((await db.query('SELECT * FROM claim_external_notification()')).rows.length,0);
await role('authenticated',dev);assert.equal(await scalar(`SELECT status AS value FROM external_notifications WHERE id='${job.id}'`),'sent');
await assert.rejects(db.exec(`SELECT retry_external_notification('${job.id}')`),e=>e.code==='22023');
await db.exec(`SELECT review_report_resolution('${ev}','reopen','Нужно показать результат работ')`);
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM external_notifications WHERE event_type='evidence_rejected' AND organization_id='${org2}' AND reason='Нужно показать результат работ'`)),1);
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM external_notifications WHERE event_type='claim_released'`)),2);
// Unknown/crashed attempts cannot be resent after provider deduplication expires.
await role('service_role');job=(await db.query('SELECT * FROM claim_external_notification()')).rows[0];assert.equal(job.event_type,'claim_released');
await db.query('SELECT begin_external_attempt($1,$2,$3)',[job.id,job.lease_token,JSON.stringify(payload)]);
await role('postgres');await db.exec(`UPDATE external_notifications SET first_attempt_at=now()-interval '25 hours',lease_until=now()-interval '1 minute' WHERE id='${job.id}'`);
await role('service_role');assert.equal((await db.query('SELECT * FROM claim_external_notification()')).rows.length,0);
await role('authenticated',dev);assert.equal(await scalar(`SELECT status AS value FROM external_notifications WHERE id='${job.id}'`),'uncertain');
await assert.rejects(db.exec(`SELECT retry_external_notification('${job.id}')`),e=>e.code==='22023');
// New attempt + independent verification, with low-precision GPS accepted.
await role('authenticated',op);await db.exec(`SELECT claim_report('${newReport}');INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op}/${newReport}/b.jpg')`);
const ev2=(await db.query('SELECT submit_report_resolution($1,$2,$3,$4::jsonb) AS value',[newReport,'repair complete',`${op}/${newReport}/b.jpg`,gps({accuracy:100000})])).rows[0].value;
await role('authenticated',dev);await db.exec(`SELECT review_report_resolution('${ev2}','verify')`);
assert.equal(Number(await scalar(`SELECT count(*) AS value FROM external_notifications WHERE event_type='resolution_verified' AND organization_id='${org}'`)),1);
await assert.rejects(db.exec(`UPDATE external_notifications SET status='sent' WHERE event_type='resolution_verified'`),e=>e.code==='42501');
await assert.rejects(db.exec(`INSERT INTO organization_messages(report_id,organization_id,direction,channel,destination,body,status) VALUES('${newReport}','${org}','outbound','email','test@example.invalid','test','sent')`),e=>e.code==='42501');
await role('anon');assert.equal(Number(await scalar(`SELECT count(*) AS value FROM report_resolutions WHERE report_id='${newReport}'`)),2);
await assert.rejects(db.exec(`SELECT resolution_resident_feedback('${ev2}','40000000-0000-4000-8000-000000000001','reopen')`),e=>e.code==='42501');
if(process.env.CLAIM_TEST_DATABASE_URL){
 const {Client}=(await import(process.env.PG_MODULE)).default;
 await role('postgres');await db.exec(`UPDATE external_notifications SET status='cancelled' WHERE status IN ('pending','retry','processing');INSERT INTO reports(category,description,address,latitude,longitude) VALUES('roads','queue race one','isolated',43.65,51.15),('roads','queue race two','isolated',43.65,51.15)`);
 const ca=new Client({connectionString:process.env.CLAIM_TEST_DATABASE_URL}),cb=new Client({connectionString:process.env.CLAIM_TEST_DATABASE_URL});await ca.connect();await cb.connect();
 await ca.query(`BEGIN;SET LOCAL ROLE service_role;SET LOCAL request.jwt.claim.role='service_role'`);
 const one=(await ca.query('SELECT * FROM claim_external_notification()')).rows[0];
 await cb.query(`BEGIN;SET LOCAL ROLE service_role;SET LOCAL request.jwt.claim.role='service_role'`);
 const two=(await cb.query('SELECT * FROM claim_external_notification()')).rows[0];assert(one&&two);assert.notEqual(one.id,two.id);
 await ca.query('COMMIT');await cb.query('COMMIT');
 await ca.query(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${op}';SELECT claim_report('${race}')`);
 await cb.query(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${op2}'`);
 const pid=(await cb.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 let done=false;const contender=cb.query(`SELECT claim_report('${race}')`).then(()=>({winner:true}),e=>({code:e.code})).finally(()=>done=true);
 let blocked=false;for(let i=0;i<50;i++){const q=await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);if(q.rows[0]?.wait_event_type==='Lock'){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
 assert(blocked&&!done);await ca.query('COMMIT');assert.equal((await contender).code,'40001');await cb.query('ROLLBACK');await ca.end();await cb.end();
 console.log('PASS: native PostgreSQL two-session queue workers claim different rows; competing organization claim still has exactly one winner.');
}
console.log('PASS: mandatory GPS in DB/old RPC closed, poor accuracy accepted, derived-only storage, reviewer-only diagnostics, atomic organization outbox, unsupported-channel exceptions, stale task suppression, all lifecycle events, immutable payload/retry identity/lease fencing, 23h safety cutoff, no fabricated sent state, independent finality/public evidence.');
await db.close();
