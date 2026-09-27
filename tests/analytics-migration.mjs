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
const op='10000000-0000-4000-8000-000000000001', dev='10000000-0000-4000-8000-000000000002', outsider='10000000-0000-4000-8000-000000000003';
await db.exec(`INSERT INTO auth.users VALUES('${op}'),('${dev}'),('${outsider}');
INSERT INTO operator_profiles(id,is_operator,role) VALUES('${op}',true,'operator'),('${dev}',true,'developer');`);
const role=async(r,user='')=>db.exec(`RESET ROLE; SET request.jwt.claim.sub='${user}'; SET request.jwt.claim.role='${r}'; SET ROLE ${r};`);
const rpc=async(q)=>(await db.query('SELECT * FROM '+q)).rows;
await role('authenticated',op);
assert.equal(Number((await rpc('get_city_intelligence_summary(NULL,NULL)'))[0].total_reports),0);
assert.deepEqual(await rpc('get_heatmap_data(NULL,NULL)'),[]);
await role('authenticated',outsider);
await assert.rejects(rpc('get_city_intelligence_summary(NULL,NULL)'),e=>e.code==='42501');
await assert.rejects(rpc('city_intelligence_facts(NULL,NULL)'),e=>e.code==='42501');
await role('anon');
await assert.rejects(rpc('get_heatmap_data(NULL,NULL)'),e=>e.code==='42501');
await db.exec('RESET ROLE');
// Synthetic records exist ONLY in this in-memory database, never in Supabase or the app.
const ids=Array.from({length:9},(_,i)=>`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
for(let i=0;i<ids.length;i++) await db.exec(`INSERT INTO reports(id,category,description,address,latitude,longitude,created_at)
VALUES('${ids[i]}','${i===8?'water':'roads'}','isolated test','isolated test',${i===7?100:43.65+(i>=3?.03:0)},${51.15+(i%3)*.0001},now()-interval '${i===6?400:2} days')`);
// One independently verified report, another reopened by resident history.
await db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('resolution-images','${op}/${ids[0]}/a.jpg');`);
await role('authenticated',op);
const resolution=(await rpc(`submit_report_resolution('${ids[0]}','isolated repair','${op}/${ids[0]}/a.jpg')`))[0].submit_report_resolution;
await role('authenticated',dev); await db.exec(`SELECT review_report_resolution('${resolution}','verify')`);
await db.exec('RESET ROLE');
await db.exec(`INSERT INTO report_events(report_id,event_type,title,actor_type) VALUES('${ids[1]}','resolution_reopened','isolated reopen','resident');
INSERT INTO report_supports(report_id,supporter_token) SELECT '${ids[0]}',gen_random_uuid() FROM generate_series(1,20);`);
await role('authenticated',op);
let k=(await rpc('get_city_intelligence_summary(NULL,NULL)'))[0];
assert.equal(Number(k.total_reports),9); assert.equal(Number(k.verified_resolved),1); assert.equal(Number(k.reopened_reports),1);
assert.equal(Number(k.total_supports),20); assert(Number(k.avg_resolution_hours)>=48);
for(const days of [7,30,90]) {
 const sum=(await rpc(`get_city_intelligence_summary(${days},NULL)`))[0];
 assert.equal(Number(sum.total_reports),8);
 const trend=await rpc(`get_time_trend_data(${days},NULL,NULL)`);
 assert.equal(trend.reduce((n,x)=>n+Number(x.report_count),0),8);
}
assert.equal((await rpc('get_time_trend_data(NULL,NULL,NULL)')).reduce((n,x)=>n+Number(x.report_count),0),9);
assert.equal(Number((await rpc("get_city_intelligence_summary(NULL,'water')"))[0].total_reports),1);
const heat=await rpc('get_heatmap_data(NULL,NULL)');
assert.equal(heat.length,8); assert(heat.every(p=>Number(p.intensity)>=1&&Number(p.intensity)<=1.5));
const zones=await rpc('detect_hotspots(30,NULL,150,3)');
assert.equal(zones.length,2); assert(zones.every(z=>Number(z.report_count)===3));
assert.deepEqual(await rpc('detect_hotspots(30,NULL,150,3)'),zones); // stable cluster IDs
assert.equal((await rpc("get_heatmap_data(NULL,'water')")).length,1);
assert.equal((await rpc("detect_hotspots(NULL,'water',150,3)")).length,0);
await role('authenticated',dev); await db.exec(`SELECT review_report_resolution('${resolution}','reopen')`);
k=(await rpc('get_city_intelligence_summary(NULL,NULL)'))[0];
assert.equal(Number(k.verified_resolved),0); assert.equal(Number(k.reopened_reports),2); assert.equal(k.avg_resolution_hours,null);
assert((await rpc('get_category_analytics(NULL)')).length>0);
await assert.rejects(rpc('get_city_intelligence_summary(0,NULL)'),e=>e.code==='22023');
console.log('PASS: 00009 failures reproduced; 00010 empty/error security; real schema; all-time, 7/30/90, category, independent verification, resident/developer reopen, bounded heat, invalid coordinates, separate stable clusters.');
await db.close();
