const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');const {NextRequest}=require('next/server');
function load(file,mocks={}){const m={exports:{}};new Function('exports','require','module',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m.exports,n=>mocks[n]||require(n),m);return m.exports;}
const id='30000000-0000-4000-8000-000000000001';let allowed=false,calls=[],rpcError=null;
const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{can_claim:true},error:rpcError};}};
const claim=load('app/api/reports/[id]/claim/route.ts',{'@/lib/server/authorization':{requestDatabase:()=>db,hasRole:async(_,r)=>allowed&&r==='operator'}});
const request=(body)=>new NextRequest('http://localhost/api/reports/'+id+'/claim',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
(async()=>{
 assert.equal((await claim.POST(request({organizationId:'forged'}),{params:{id}})).status,403);assert.equal(calls.length,0);allowed=true;
 assert.equal((await claim.POST(request({organizationId:'forged'}),{params:{id}})).status,200);assert.deepEqual(calls,[{name:'claim_report',args:{p_report_id:id}}]);
 rpcError={code:'40001'};assert.equal((await claim.POST(request({}),{params:{id}})).status,409);
 const narrative=load('lib/analytics-insights/narrative.ts',{'@/lib/category-discovery/gemini-transport':{categoryContent:async()=>'{"sentences":["Выдумано 999 проблем.","Организация лучшая."]}'},'@/lib/category-discovery/diagnostics':{safeError:()=>({code:'ERROR'})}});
 const choices=narrative.factSentences(3,2,4);assert.ok(narrative.validateNarrative({sentences:[choices[0][0],choices[1][1]]},choices));
 for(const sentences of [[choices[0][0].replace('3','999'),choices[1][0]],['Завтра станет хуже.',choices[1][0]],[choices[1][0],choices[1][0]]])assert.equal(narrative.validateNarrative({sentences},choices),null);
 process.env.GEMINI_API_KEY='test-only';assert.equal(await narrative.narrateFacts(choices),null);
 let staff=false,aiCalls=0;const insights=load('app/api/analytics/insights/route.ts',{'@/lib/server/authorization':{requestDatabase:()=>({rpc:async name=>({data:name==='detect_hotspots'?[{}]:name==='get_systemic_issues'?{issues:[]}:{unassigned_count:2},error:null})}),hasRole:async()=>staff},'@/lib/analytics-insights/narrative':{factSentences:narrative.factSentences,narrateFacts:async()=>{aiCalls++;return null;}}});
 assert.equal((await insights.POST(request({days:30,category:null}))).status,403);assert.equal(aiCalls,0);staff=true;
 assert.equal((await insights.POST(request({days:30,category:null,facts:{unassigned_count:999}}))).status,400);assert.equal(aiCalls,0);
 const unavailable=await insights.POST(request({days:30,category:null}));assert.equal(unavailable.status,200);assert.deepEqual(await unavailable.json(),{text:null});assert.equal(aiCalls,1);
 console.log('PASS: claim API authorization/organization forgery/conflict; AI accepts only trusted fact wording, rejects invented metrics/rankings/predictions, rejects client facts, fails independently.');
})().catch(e=>{console.error(e);process.exitCode=1});
