const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('node:assert/strict');
const {NextRequest}=require('next/server');
let role='operator',user='10000000-0000-4000-8000-000000000001',author='10000000-0000-4000-8000-000000000002';
let calls=[],failure=null,allowedReport=true,resolutionState='pending';
const db={
 auth:{getUser:async()=>({data:{user:{id:user}}})},
 from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{id:resolution,state:resolutionState,submitted_by:author,after_photo_path:'test.png'}})})})})}),
 rpc:async(name,args)=>{calls.push({name,args});return {data:null,error:failure}},
};
function load(file) {
 const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};
 new Function('exports','require','module',code)(module.exports,(name)=>{
  if(name==='@/lib/server/authorization')return {requestDatabase:()=>db,hasRole:async(_db,required)=>role===required,advisoryDatabase:()=>null,canOperateReport:async()=>allowedReport};
  if(name==='@/lib/resolutions/ai')return {compareEvidence:async()=>{throw Error('must not be reached')}};
  if(name==='@/lib/resolutions/images')return {fetchEvidence:async()=>{throw Error('must not be reached')}};
  return require(name);
 },module);return module.exports;
}
const resolution='20000000-0000-4000-8000-000000000001',report='30000000-0000-4000-8000-000000000001';
const {POST}=load('app/api/reports/[id]/resolutions/route.ts');const {GET}=load('app/api/review/route.ts');
const post=(action)=>POST(new NextRequest('http://localhost/api/reports/'+report+'/resolutions',{
 method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-only'},body:JSON.stringify({action,resolutionId:resolution,...(action==='feedback'?{token:'40000000-0000-4000-8000-000000000001',decision:'reopen'}:{})}),
}),{params:{id:report}});
(async()=>{
 for(const actor of ['operator','resident',null]){
  role=actor;calls=[];
  for(const action of ['verify','reopen'])assert.equal((await post(action)).status,403);
  assert.equal((await GET(new NextRequest('http://localhost/api/review'))).status,403);
  assert.equal(calls.length,0);
 }
 role='developer';author=user;assert.equal((await post('verify')).status,403);assert.equal(calls.length,0);
 author=null;assert.equal((await post('verify')).status,403);
 author='10000000-0000-4000-8000-000000000002';
 assert.equal((await post('verify')).status,200);assert.equal(calls[0].name,'review_report_resolution');assert.equal(calls[0].args.p_decision,'verify');
 assert.equal((await post('reopen')).status,200);assert.equal(calls[1].args.p_decision,'reopen');
 failure={code:'42501'};assert.equal((await post('verify')).status,403);failure=null;
 role='operator';calls=[];allowedReport=false;assert.equal((await post('analyze')).status,403);allowedReport=true;const pending=await post('analyze');assert.equal(pending.status,200);assert.equal((await pending.json()).manualReview,true);assert.equal(calls.length,0);
 resolutionState='verified';role=null;calls=[];assert.equal((await post('feedback')).status,403);assert.equal(calls.length,0);
 console.log('PASS: API operator/anon/nonstaff rejected before mutation; review queue role gate; own/unknown evidence denied; developer decision RPC; DB denial maps to 403; missing AI credential stays manual.');
})().catch(e=>{console.error(e);process.exitCode=1});
