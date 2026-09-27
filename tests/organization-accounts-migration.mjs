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
await assert.rejects(db.query('SELECT * FROM get_city_intelligence_kpis(NULL)'),e=>e.code==='42702');
await assert.rejects(db.query('SELECT * FROM detect_hotspots(NULL,NULL,150,3)'),e=>e.code==='42702');
await assert.rejects(db.query('SELECT * FROM get_heatmap_data(NULL,NULL)'),e=>e.code==='42883');
await db.exec(readFileSync(new URL('../supabase/migrations/20260926000010_fix_city_intelligence_analytics.sql',import.meta.url),'utf8'));

await db.exec(readFileSync(new URL('../supabase/migrations/20260926000011_systemic_issues_service_performance.sql',import.meta.url),'utf8'));

const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const opA=uid(1),opB=uid(2),dev=uid(3),legacy=uid(4),secondA=uid(5),orgA=uid(101),orgB=uid(102),orgC=uid(103);
await db.exec(`INSERT INTO auth.users VALUES('${opA}'),('${opB}'),('${dev}'),('${legacy}'),('${secondA}');
INSERT INTO operator_profiles(id,is_operator,role) VALUES('${opA}',true,'operator'),('${opB}',true,'operator'),('${dev}',true,'developer'),('${legacy}',true,'operator');
INSERT INTO organizations(id,name,category,channel,destination) VALUES('${orgA}','Alpha','roads','web','private-A'),('${orgB}','Beta','roads','web','private-B'),('${orgC}','Gamma','water','web','private-C');
GRANT SELECT,INSERT,UPDATE,DELETE ON organization_messages,organizations TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON report_supports TO authenticated;`);
await db.exec(readFileSync(new URL('../supabase/migrations/20260927000012_organization_operator_accounts.sql',import.meta.url),'utf8'));
assert.equal((await db.query('SELECT count(*)::int AS n FROM operator_profiles')).rows[0].n,4);
await db.exec(`UPDATE operator_profiles SET organization_id='${orgA}' WHERE id='${opA}';
UPDATE operator_profiles SET organization_id='${orgB}' WHERE id='${opB}';
INSERT INTO operator_profiles(id,is_operator,role,organization_id) VALUES('${secondA}',true,'operator','${orgA}');`);
const role=async(user,role='authenticated')=>db.exec(`RESET ROLE; SET request.jwt.claim.sub='${user}'; SET request.jwt.claim.role='${role}'; SET ROLE ${role};`);
const rpc=async(name,args='')=>(await db.query(`SELECT ${name}(${args}) AS value`)).rows[0].value;
const ra=uid(201),rb=uid(202),unassigned=uid(203),water=uid(204);
await db.exec(`INSERT INTO reports(id,category,description,address,latitude,longitude,organization_id) VALUES
('${ra}','roads','isolated','isolated',43.65,51.15,'${orgA}'),('${rb}','roads','isolated','isolated',43.65,51.15,'${orgB}'),
('${unassigned}','roads','isolated','isolated',43.65,51.15,NULL),('${water}','water','isolated','isolated',43.65,51.15,NULL)`);
for(const [actor,own,other,org] of [[opA,ra,rb,orgA],[opB,rb,ra,orgB],[secondA,ra,rb,orgA]]){
 await role(actor);assert.equal(await rpc('operator_organization_id'),org);assert.equal(await rpc('can_operate_report',`'${own}'`),true);assert.equal(await rpc('can_operate_report',`'${other}'`),false);
 assert.deepEqual((await db.query('SELECT id FROM get_operational_reports()')).rows.map(x=>x.id),[own]);
 assert.equal((await db.query(`UPDATE reports SET status='in_progress' WHERE id='${own}' RETURNING id`)).rows.length,1);
 assert.equal((await db.query(`UPDATE reports SET status='in_progress' WHERE id='${other}' RETURNING id`)).rows.length,0);
 await assert.rejects(db.query(`UPDATE reports SET organization_id='${org}' WHERE id='${other}'`),e=>e.code==='42501');
 await assert.rejects(db.query(`UPDATE operator_profiles SET organization_id='${orgB}',role='developer' WHERE id='${actor}'`),e=>e.code==='42501');
 assert.deepEqual((await db.query('SELECT id FROM organizations')).rows.map(x=>x.id),[org]);
 await assert.rejects(rpc('submit_report_resolution',`'${other}','isolated evidence','${actor}/${other}/a.jpg'`),e=>e.code==='42501');
 await assert.rejects(db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${actor}/${other}/a.jpg')`),e=>e.code==='42501');
 await assert.rejects(rpc('create_report_event',`'${other}','message_prepared','forged'`),e=>e.code==='42501');
 await assert.rejects(rpc('create_report_event',`'${own}','routed','forged'`),e=>e.code==='42501');
 await assert.rejects(rpc('create_report_event',`'${own}','message_prepared','forged',NULL,'operator',NULL,'${org===orgA?orgB:orgA}'`),e=>e.code==='42501');
 await assert.rejects(db.exec(`INSERT INTO report_events(report_id,event_type,title,actor_type) VALUES('${own}','routed','forged','operator')`),e=>e.code==='42501');
}
await role(legacy);assert.equal(await rpc('operator_organization_id'),null);assert.equal((await db.query('SELECT * FROM get_operational_reports()')).rows.length,0);
assert.equal((await db.query('SELECT id FROM organization_messages')).rows.length,0);
await role('', 'anon');
await assert.rejects(db.exec(`INSERT INTO reports(category,description,address,latitude,longitude,organization_id) VALUES('roads','spoof','isolated',43.65,51.15,'${orgA}')`),e=>e.code==='42501');
assert.equal(await rpc('assign_report_organization',`'${unassigned}'`),null);assert.equal(await rpc('get_responsible_organization',"'roads'"),null);
assert.equal(await rpc('assign_report_organization',`'${water}'`),orgC);
assert.equal(await rpc('assign_report_organization',`'${ra}'`),orgA); // preserve existing assignment despite ambiguous mapping
const submit=async(actor,report)=>{
 await role(actor);await db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${actor}/${report}/a.jpg')`);
 return rpc('submit_report_resolution',`'${report}','isolated evidence','${actor}/${report}/a.jpg'`);
};
const ea=await submit(opA,ra),eb=await submit(opB,rb);
await assert.rejects(rpc('review_report_resolution',`'${eb}','verify'`),e=>e.code==='42501');
await role(dev);assert.equal(await rpc('operator_organization_id'),null);assert.equal((await db.query('SELECT id FROM get_operational_reports()')).rows.length,4);
await rpc('review_report_resolution',`'${ea}','verify'`);await rpc('review_report_resolution',`'${eb}','verify'`);
let service=await rpc('get_service_performance','NULL,NULL');
assert.equal(service.total_reports,4);assert.equal(service.unassigned_count,1);
assert.deepEqual(service.organizations.map(x=>[x.organization_name,x.assigned_count,x.verified_count]),[['Alpha',1,1],['Beta',1,1],['Gamma',1,0]]);
assert(service.organizations.every(x=>x.avg_resolution_hours===null));
await rpc('review_report_resolution',`'${eb}','reopen'`);service=await rpc('get_service_performance','NULL,NULL');assert.equal(service.organizations[1].verified_count,0);assert.equal(service.organizations[1].reopened_count,1);
// A former operator promoted to independent developer still cannot self-review.
await db.exec(`RESET ROLE; UPDATE operator_profiles SET role='developer',organization_id=NULL WHERE id='${opB}'`);
await role(opB);await assert.rejects(rpc('review_report_resolution',`'${eb}','verify'`),e=>e.code==='42501');
await db.exec(`RESET ROLE; UPDATE operator_profiles SET role='operator',organization_id='${orgB}' WHERE id='${opB}'`);
// Private communications: forged organization/report combinations fail on RLS.
await role(opA);const msg=(await db.query(`INSERT INTO organization_messages(report_id,organization_id,direction,channel,destination,body,status) VALUES('${ra}','${orgA}','outbound','web','private-A','private test','draft') RETURNING id`)).rows[0].id;
await assert.rejects(db.exec(`INSERT INTO organization_messages(report_id,organization_id,direction,channel,destination,body,status) VALUES('${rb}','${orgA}','outbound','web','private-A','forged','draft')`),e=>e.code==='42501');
await role(opB);assert.equal((await db.query(`SELECT * FROM organization_messages WHERE id='${msg}'`)).rows.length,0);
assert.equal((await db.query(`UPDATE organization_messages SET body='forged' WHERE id='${msg}' RETURNING id`)).rows.length,0);
await role(dev);assert.equal((await db.query('SELECT * FROM organization_messages')).rows.length,0); // reviewer needs evidence, not correspondence
await role(opA);const page=await rpc('get_intelligence_reports',`NULL,NULL,NULL,'${orgB}',0`);assert.equal(page.total,0);
const ownPage=await rpc('get_intelligence_reports',`NULL,NULL,NULL,'${orgA}',0`);assert.equal(ownPage.total,1);
// Administrator reassignment is audited and does not transfer the old messages.
await db.exec(`RESET ROLE; UPDATE reports SET organization_id='${orgB}' WHERE id='${ra}'`);
await role(opB);assert.equal(await rpc('can_operate_report',`'${ra}'`),true);assert.equal((await db.query('SELECT * FROM organization_messages')).rows.length,0);
await role(opA);assert.equal(await rpc('can_operate_report',`'${ra}'`),false);assert.equal((await db.query('SELECT * FROM organization_messages')).rows.length,0);
await db.exec('RESET ROLE');const audit=(await db.query(`SELECT description FROM report_events WHERE report_id='${ra}' AND event_type='routed' ORDER BY created_at DESC LIMIT 1`)).rows[0];assert.equal(audit.description,'Alpha → Beta');
await assert.rejects(db.exec(`INSERT INTO operator_profiles(id,is_operator,role) VALUES('${uid(999)}',true,'operator')`),e=>e.code==='23514');
console.log('PASS: 00012 legacy-safe migration, multiple operators/company, bidirectional organization isolation, direct/API-RPC paths, storage, spoofed profile/report/message/event rejection, independent cross-company review, author self-review denial, safe ambiguous routing, preserved assignment/audit, actual organization analytics and unassigned exclusion.');
await db.close();
