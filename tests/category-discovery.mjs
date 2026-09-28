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
await db.exec(readFileSync(new URL('../supabase/migrations/20260928000015_smart_category_discovery.sql',import.meta.url),'utf8'));
const op='10000000-0000-4000-8000-000000000001',dev='10000000-0000-4000-8000-000000000002',org='20000000-0000-4000-8000-000000000001';
await db.exec(`INSERT INTO auth.users VALUES('${op}'),('${dev}'); INSERT INTO organizations(id,name,category,channel,destination) VALUES('${org}','isolated','roads','web','isolated'); INSERT INTO operator_profiles(id,is_operator,role,organization_id) VALUES('${op}',true,'operator','${org}'),('${dev}',true,'developer',NULL);`);
const role=async(r,user='')=>db.exec(`RESET ROLE; SET request.jwt.claim.sub='${user}'; SET ROLE ${r};`);
const scalar=async(sql,params)=>(await db.query(sql,params)).rows[0].value;
const rpc=async(name,args)=>scalar(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,args);
let seq=0;
async function report(category='other',photo='https://example.invalid/real.png',age='0 minutes') {
 await role('postgres');
 const id='30000000-0000-4000-8000-'+String(++seq).padStart(12,'0');
 await db.query(`INSERT INTO reports(id,category,description,address,latitude,longitude,photo_url,created_at) VALUES($1,$2,'source description','isolated',43.65,51.15,$3,now()-$4::interval)`,[id,category,photo,age]);
 return id;
}
const result=(key=null,confidence=.95,name='Озеленение')=>({matches_existing_category:!!key,existing_category:key,suggested_new_category:key?null:name,confidence,reason:'Observed in the uploaded photo'});
const finish=(id,r)=>rpc('finish_category_discovery',[id,r]);
const row=async(id)=>(await db.query('SELECT category,ai_category,organization_id FROM reports WHERE id=$1',[id])).rows[0];
const fresh=await report();
for(const [r,u] of [['anon',''],['authenticated',op]]) {
 await role(r,u);
 for(const [name,args] of [['claim_category_discovery',[fresh]],['finish_category_discovery',[fresh,result('roads')]],['route_discovered_category',[fresh,'roads']],['review_category_suggestion',[fresh,'accept',null,null]]]) await assert.rejects(rpc(name,args),e=>e.code==='42501');
 if(r==='anon')await assert.rejects(db.query('SELECT * FROM category_discoveries'),e=>e.code==='42501');
 else assert.equal((await db.query('SELECT * FROM category_discoveries')).rows.length,0);
}
await role('service_role');const claim=await rpc('claim_category_discovery',[fresh]);assert.equal(claim.description,'source description');assert.equal(claim.photo_url,'https://example.invalid/real.png');assert.equal(await rpc('claim_category_discovery',[fresh]),null);
assert.equal(await finish(fresh,result('roads')),org);
await role('postgres');assert.deepEqual(await row(fresh),{category:'other',ai_category:'roads',organization_id:org});
for(const [category,photo,age] of [['roads','https://example.invalid/a.png','0 minutes'],['other',null,'0 minutes'],['other','https://example.invalid/a.png','6 minutes']]){
 const id=await report(category,photo,age);await role('service_role');assert.equal(await rpc('claim_category_discovery',[id]),null);
}
for(const r of [null,result('roads',.84),result(null,.4)]) {
 const id=await report();await role('service_role');await rpc('claim_category_discovery',[id]);await finish(id,r);await role('postgres');assert.deepEqual(await row(id),{category:'other',ai_category:null,organization_id:null});
}
const pending=await report();await role('service_role');await rpc('claim_category_discovery',[pending]);await finish(pending,result());
await role('postgres');assert.equal(await scalar('SELECT count(*)::int AS value FROM category_catalog'),8);assert.equal((await row(pending)).ai_category,null);
await role('authenticated',op);assert.equal((await db.query('SELECT * FROM category_discoveries')).rows.length,0);await assert.rejects(rpc('review_category_suggestion',[pending,'accept',null,null]),e=>e.code==='42501');
await role('authenticated',dev);assert.ok((await db.query('SELECT * FROM category_discoveries')).rows.length>0);const key=await rpc('review_category_suggestion',[pending,'accept',null,null]);assert.ok(key.startsWith('discovered_'));await assert.rejects(rpc('review_category_suggestion',[pending,'reject',null,null]),e=>e.code==='22023');
await role('postgres');assert.equal(await scalar('SELECT count(*)::int AS value FROM category_catalog'),9);assert.deepEqual(await row(pending),{category:'other',ai_category:key,organization_id:null});
const duplicate=await report();await role('service_role');await rpc('claim_category_discovery',[duplicate]);await finish(duplicate,result(null,.99,'ОЗЕЛЕНЕНИЯ'));await role('authenticated',dev);assert.equal(await rpc('review_category_suggestion',[duplicate,'accept',' ОЗЕЛЕНЕНИЯ ',null]),key);
await role('postgres');assert.equal(await scalar('SELECT count(*)::int AS value FROM category_catalog'),9);
const rejected=await report();await role('service_role');await rpc('claim_category_discovery',[rejected]);await finish(rejected,result(null,.95,'Животные'));await role('authenticated',dev);await rpc('review_category_suggestion',[rejected,'reject',null,null]);await role('postgres');assert.deepEqual(await row(rejected),{category:'other',ai_category:null,organization_id:null});
const merged=await report();await role('service_role');await rpc('claim_category_discovery',[merged]);await finish(merged,result(null,.95,'Асфальт'));await role('authenticated',dev);assert.equal(await rpc('review_category_suggestion',[merged,'accept',null,'roads']),'roads');await role('postgres');assert.equal((await row(merged)).organization_id,org);
const ambiguous=await report();await db.exec(`INSERT INTO organizations(name,category,channel,destination) VALUES('second','roads','web','isolated')`);await role('service_role');await rpc('claim_category_discovery',[ambiguous]);await finish(ambiguous,result('roads'));await role('postgres');assert.equal((await row(ambiguous)).organization_id,null);
const assigned=await report();await db.query('UPDATE reports SET organization_id=$1 WHERE id=$2',[org,assigned]);await role('service_role');await rpc('claim_category_discovery',[assigned]);await finish(assigned,result('water'));await role('postgres');assert.equal((await row(assigned)).organization_id,org);
const enabled=await report();await db.query('UPDATE category_catalog SET active=false WHERE key=$1',[key]);await role('service_role');await rpc('claim_category_discovery',[enabled]);await finish(enabled,result(null,.95,'Зелёные насаждения'));await role('authenticated',dev);assert.equal(await rpc('review_category_suggestion',[enabled,'accept',null,key]),key);await role('postgres');assert.equal(await scalar('SELECT active AS value FROM category_catalog WHERE key=$1',[key]),true);
for(const [r,u] of [['anon',''],['authenticated',op],['authenticated',dev]]){await role(r,u);await assert.rejects(db.query("INSERT INTO category_catalog(key,name) VALUES('forged','Подделка')"),e=>e.code==='42501');}
await role('postgres');assert.equal(await scalar("SELECT category_name_fingerprint('ЗЕЛЁНЫЕ НАСАЖДЕНИЯ')=category_name_fingerprint('насаждения зеленые') AS value"),true);
const invalid=await report();await role('service_role');await rpc('claim_category_discovery',[invalid]);await assert.rejects(finish(invalid,result('invented')));await finish(invalid,null);
console.log('PASS: private service-only classification; fresh other/photo eligibility; one attempt; original selection preserved; confident routing; safe failure/low confidence; developer-only review; human creation/merge/reject; near-duplicate reuse; ambiguous organization unchanged.');
await db.close();
