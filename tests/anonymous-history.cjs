const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,mocks={}){const m={exports:{}};new Function('exports','require','module',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m.exports,n=>mocks[n]||require(n),m);return m.exports;}
function storage(){const m=new Map();return {get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),clear:()=>m.clear()};}
const a=storage(),b=storage(),first='30000000-0000-4000-8000-000000000001',second='30000000-0000-4000-8000-000000000002';
(async()=>{
 global.window={localStorage:a};const history=load('lib/anonymous-history.ts');const token=history.anonymousHistoryOwner();assert.equal(history.anonymousHistoryOwner(),token);assert.deepEqual(history.ownedReportIds(),[]);
 a.setItem('aqtau_supporter_token',second);assert.notEqual(token,second);history.rememberCreatedReport(first);assert.deepEqual(history.ownedReportIds(),[first]);
 const reloaded=load('lib/anonymous-history.ts');assert.equal(reloaded.anonymousHistoryOwner(),token);assert.deepEqual(reloaded.ownedReportIds(),[first]);
 global.window={localStorage:b};const other=load('lib/anonymous-history.ts');assert.notEqual(other.anonymousHistoryOwner(),token);assert.deepEqual(other.ownedReportIds(),[]);other.rememberCreatedReport(second);
 global.window={localStorage:a};assert.deepEqual(reloaded.ownedReportIds(),[first]);a.clear();assert.deepEqual(reloaded.ownedReportIds(),[]);
 global.window={get localStorage(){throw Error('blocked')}};const blocked=load('lib/anonymous-history.ts');assert.doesNotThrow(()=>blocked.rememberCreatedReport(first));assert.deepEqual(blocked.ownedReportIds(),[first]);
 let queries=0;const db={from:()=>{queries++;return {select(){return this},in:async(column,ids)=>{assert.equal(column,'id');assert.deepEqual(ids,[first]);return {data:[{id:first,createdAt:'2026-09-28'}],error:null}}}},rpc:async()=>({data:0,error:null})};let owned=[];
 const mine=load('lib/my-reports.ts',{'./supabase-client':{supabase:db},'./anonymous-history':{ownedReportIds:()=>owned},'./types':{rowToReport:r=>r}});
 assert.deepEqual(await mine.fetchMyReports(),[]);assert.equal(queries,0);owned=[first];assert.equal((await mine.fetchMyReports())[0].id,first);assert.equal(queries,1);
 let receipt=[],insertError=null;
 const create=load('lib/reports.ts',{'./supabase-client':{supabase:{from:()=>({insert(){return this},select(){return this},single:async()=>({data:{id:first},error:insertError})})}},'./anonymous-history':{rememberCreatedReport:id=>receipt.push(id)},'./types':{rowToReport:r=>r},'./events/report-events':{}}).createReport;
 global.window={localStorage:a};await create({category:'other'});assert.deepEqual(receipt,[first]);receipt=[];insertError=Error('insert denied');await assert.rejects(create({category:'other'}));assert.deepEqual(receipt,[]);
 console.log('PASS: separate browser UUID; reload persistence; two-browser isolation; clearing/blocked storage; no legacy guessing; ID-filtered reads; only successful inserts remembered; no authorization change.');
})().catch(e=>{console.error(e);process.exitCode=1});
