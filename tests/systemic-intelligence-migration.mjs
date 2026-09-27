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
const op='10000000-0000-4000-8000-000000000001',dev='10000000-0000-4000-8000-000000000002',outsider='10000000-0000-4000-8000-000000000003';
await db.exec(`INSERT INTO auth.users VALUES('${op}'),('${dev}'),('${outsider}');
INSERT INTO operator_profiles(id,is_operator,role) VALUES('${op}',true,'operator'),('${dev}',true,'developer');`);
const role=async(user)=>db.exec(`RESET ROLE; SET request.jwt.claim.sub='${user}'; SET ROLE authenticated;`);
const rpc=async(name,args='NULL,NULL')=>(await db.query(`SELECT ${name}(${args}) AS data`)).rows[0].data;
const issues=async(args)=>{await role(op);return (await rpc('get_systemic_issues',args)).issues;};
const services=async(args)=>{await role(op);return await rpc('get_service_performance',args);};
const uid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const orgA='30000000-0000-4000-8000-000000000001',orgB='30000000-0000-4000-8000-000000000002';
await db.exec(`INSERT INTO organizations(id,name,category,channel,destination) VALUES('${orgA}','Alpha','roads','web','isolated'),('${orgB}','Beta','water','web','isolated')`);
const anchor=(await db.query('SELECT now()::text AS t')).rows[0].t;
const reset=async()=>{await db.exec('RESET ROLE; TRUNCATE reports CASCADE; TRUNCATE storage.objects;');};
const seed=async(n,days=1,lat=43.65,lng=51.15,cat='roads',org=null)=>{
 await db.exec('RESET ROLE');
 await db.query(`INSERT INTO reports(id,category,description,address,latitude,longitude,created_at,organization_id)
 VALUES($1,$2,'isolated integration test','isolated',$3,$4,$5::timestamptz-make_interval(secs=>$6),$7)`,[uid(n),cat,lat,lng,anchor,days*86400,org]);
};
const reopen=async(n)=>{await db.exec(`RESET ROLE; INSERT INTO report_events(report_id,event_type,title,actor_type) VALUES('${uid(n)}','resolution_reopened','isolated','resident')`);};
const verify=async(n,hours)=>{
 await db.exec(`RESET ROLE; INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op}/${uid(n)}/${hours}.jpg')`);
 await role(op);const id=await rpc('submit_report_resolution',`'${uid(n)}','isolated repair','${op}/${uid(n)}/${hours}.jpg'`);
 await role(dev);await rpc('review_report_resolution',`'${id}','verify'`);
 await db.exec(`RESET ROLE; UPDATE resolution_reviews SET reviewed_at=(SELECT created_at+interval '${hours} hours' FROM reports WHERE id='${uid(n)}') WHERE resolution_id='${id}';
 UPDATE report_resolutions SET reviewed_at=(SELECT created_at+interval '${hours} hours' FROM reports WHERE id='${uid(n)}') WHERE id='${id}';`);
 return id;
};
await role(op);
assert.deepEqual((await rpc('get_systemic_issues')).issues,[]);
assert.equal((await rpc('get_service_performance')).total_reports,0);
for(const user of [outsider,'']){await role(user);for(const name of ['get_systemic_issues','get_service_performance'])await assert.rejects(rpc(name),e=>e.code==='42501');}
await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(rpc('get_systemic_issues'),e=>e.code==='42501');
await role(op);for(const name of ['city_intelligence_4b_config','city_intelligence_4b_members'])await assert.rejects(rpc(name,name.endsWith('config')?'':'NULL,NULL'),e=>e.code==='42501');
// Fixtures are created only in this in-memory PostgreSQL database, never in Supabase.
await reset();await seed(1,30);await seed(2,1);assert.equal((await issues()).length,0); // minimum three
await seed(3,1,43.68);assert.equal((await issues()).length,0); // remote third report
await reset();await seed(1,2);await seed(2,1);await seed(3,1);
await db.exec(`INSERT INTO report_supports(report_id,supporter_token) SELECT '${uid(1)}',gen_random_uuid() FROM generate_series(1,100)`);
assert.equal((await issues()).length,0); // support cannot create persistence
await reset();await seed(1,8);await seed(2,1);await seed(3,1);let result=await issues();
assert.equal(result.length,1);assert.equal(result[0].span_days,7);assert.equal(result[0].signals.time_span,true);
assert.equal((await issues('7,NULL')).length,0);assert.equal((await issues("NULL,'water'")).length,0);
await db.exec(`RESET ROLE; UPDATE reports SET created_at=created_at+interval '1 second' WHERE id='${uid(1)}'`);
assert.equal((await issues()).length,0); // below seven days
await reopen(2);result=await issues();assert.equal(result[0].signals.reopened,true);assert.equal(result[0].reopened_count,1);
await reset();for(let n=1;n<=3;n++)await seed(n,14);
result=await issues();assert.equal(result[0].signals.long_unresolved,true);assert.equal(result[0].long_unresolved_count,3);
// 149m forms edges, 151m does not. Connected chain is not falsely described as one radius.
await reset();await seed(1,8,43.65);await seed(2,1,43.65+149/6371000*180/Math.PI);await seed(3,1,43.65+298/6371000*180/Math.PI);
assert.equal((await issues()).length,1);
await reset();await seed(1,8,43.65);await seed(2,1,43.65+151/6371000*180/Math.PI);await seed(3,1,43.65+302/6371000*180/Math.PI);
assert.equal((await issues()).length,0);
await reset();await seed(1,4,43.65,51.15,'roads',orgA);await seed(2,1,43.65,51.15,'roads',orgA);await seed(3,1,43.65,51.15,'roads',orgA);
await verify(1,24);result=await issues();assert.equal(result.length,1);assert.equal(result[0].post_resolution_count,2);assert.equal(result[0].organization_name,'Alpha');
await db.exec(`RESET ROLE; UPDATE reports SET organization_id=NULL WHERE id='${uid(3)}'`);
assert.equal((await issues())[0].organization_name,null);
// Historical verified decision still supports recurrence after the old report is reopened.
await role(dev);let resolution=(await db.query(`SELECT id FROM report_resolutions WHERE report_id='${uid(1)}'`)).rows[0].id;
await rpc('review_report_resolution',`'${resolution}','reopen'`);result=await issues();assert.equal(result[0].verified_count,0);assert.equal(result[0].post_resolution_count,2);
// Service denominators, low sample threshold, true median, reopening and repeated cycles.
await reset();for(let n=1;n<=4;n++)await seed(n,10,43.65,51.15,'roads',orgA);
await seed(5,1,43.65,51.15,'water',orgB);await seed(6,1);await seed(7,100,43.65,51.15,'roads',orgB);
const first=await verify(1,24);await verify(2,48);
let data=await services();assert.equal(data.organizations[0].avg_resolution_hours,null);assert.equal(data.organizations[0].resolution_samples,2);
await verify(3,120);data=await services();let a=data.organizations[0];
assert.deepEqual(data.organizations.map(x=>x.organization_name),['Alpha','Beta']);
assert.equal(data.total_reports,7);assert.equal(data.unassigned_count,1);
assert.equal(a.assigned_count,4);assert.equal(a.active_count,1);assert.equal(a.verified_count,3);assert.equal(a.verified_share,75);
assert.equal(a.avg_resolution_hours,64);assert.equal(a.median_resolution_hours,48);assert.equal(a.verification_decisions,3);
assert.equal(data.organizations[1].median_resolution_hours,null);
await role(dev);await rpc('review_report_resolution',`'${first}','reopen'`);a=(await services()).organizations[0];
assert.equal(a.verified_count,2);assert.equal(a.active_count,2);assert.equal(a.reopened_count,1);assert.equal(a.reopen_decisions,1);assert.equal(a.verification_decisions,3);assert.equal(a.avg_resolution_hours,null);
await verify(1,168);a=(await services()).organizations[0];
assert.equal(a.verified_count,3);assert.equal(a.reopened_count,1);assert.equal(a.verification_decisions,4);assert.equal(a.avg_resolution_hours,112);assert.equal(a.median_resolution_hours,120);
assert.equal((await services("NULL,'water'")).total_reports,1);
for(const days of [7,30,90])assert.equal((await services(`${days},NULL`)).total_reports,days===7?2:6);
await role(op);await assert.rejects(rpc('get_service_performance','0,NULL'),e=>e.code==='22023');
await assert.rejects(rpc('get_intelligence_reports'),e=>e.code==='22023');
let page=await rpc('get_intelligence_reports',`NULL,NULL,NULL,'${orgA}',0`);assert.equal(page.total,4);
assert.deepEqual(Object.keys(page.reports[0]).sort(),['category','created_at','id','status']);
for(let n=10;n<62;n++)await seed(n,1,43.65,51.15,'roads',orgA);
await role(op);page=await rpc('get_intelligence_reports',`NULL,NULL,NULL,'${orgA}',0`);assert.equal(page.total,56);assert.equal(page.reports.length,50);
const page2=await rpc('get_intelligence_reports',`NULL,NULL,NULL,'${orgA}',50`);assert.equal(page2.reports.length,6);assert(!page2.reports.some(r=>page.reports.some(p=>p.id===r.id)));
const cluster=(await issues())[0];page=await rpc('get_intelligence_reports',`NULL,NULL,'${cluster.hotspot_id}',NULL,0`);assert.equal(page.total,58);
await role(dev);assert.equal((await rpc('get_service_performance')).total_reports,59);
console.log('PASS: 4B permissions, empty data, minimum/spatial/time thresholds, support-only rejection, reopen, independent post-resolution recurrence, reliable organization, current verification and cycles, exact average/median, insufficient samples, filters and paged safe drilldown.');
await db.close();
