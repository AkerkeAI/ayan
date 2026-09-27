const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
const {NextRequest}=require('next/server');
const report='10000000-0000-4000-8000-000000000001',own='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
let allowed=false,ownProfile=own,generated=0,rpcCalls=[];
const db={rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:name==='operator_organization_id'?ownProfile:null,error:null};},from:table=>{
 const result=table==='reports'?{id:report,organization_id:own,category:'roads'}:table==='organizations'?{id:own,name:'isolated',channel:'web'}:{report_id:report};
 return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:result,error:null}),then:resolve=>resolve({data:[result],error:null})};
}};
const load=file=>{const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const m={exports:{}};new Function('exports','require','module',code)(m.exports,name=>{
 if(name==='@/lib/server/authorization')return {requestDatabase:()=>db,hasRole:async(_db,role)=>allowed&&role==='developer'};
 if(name==='@/lib/messaging/organization-messages')return {generateAndStoreMessage:async(...args)=>{generated++;assert.equal(args[1],own);assert.equal(args[4],db);return {id:'draft'};}};
 if(name==='@/lib/types')return {rowToReport:r=>r};return require(name);
 },m);return m.exports;};
const generate=load('app/api/messages/generate/route.ts').POST,organizations=load('app/api/organizations/route.ts').GET,route=load('app/api/reports/[id]/route.ts').POST,messages=load('app/api/messages/report/[reportId]/route.ts').GET,edit=load('app/api/messages/[messageId]/route.ts');
const request=(path,body)=>new NextRequest('http://localhost'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
(async()=>{
 assert.equal((await generate(request('/api/messages/generate',{reportId:report,organizationId:own}))).status,403);assert.equal(generated,0);
 allowed=true;assert.equal((await generate(request('/api/messages/generate',{reportId:report,organizationId:other}))).status,403);assert.equal(generated,0);
 assert.equal((await generate(request('/api/messages/generate',{reportId:report,organizationId:own}))).status,200);assert.equal(generated,1);
 allowed=false;assert.equal((await organizations(request('/api/organizations?id='+other))).status,403);allowed=true;
 assert.equal((await organizations(request('/api/organizations?id='+own))).status,200);
 allowed=false;assert.equal((await organizations(request('/api/organizations'))).status,403);
 allowed=false;assert.equal((await messages(request('/api/messages/report/'+report),{params:{reportId:report}})).status,403);
 assert.equal((await edit.DELETE(request('/api/messages/id'),{params:{messageId:'id'}})).status,403);
 assert.equal((await edit.PATCH(request('/api/messages/id',{body:'forged'}),{params:{messageId:'id'}})).status,403);
 rpcCalls=[];const routed=await route(request('/api/reports/'+report,{organizationId:other,category:'water'}),{params:{id:report}});
 assert.equal(routed.status,200);assert.equal((await routed.json()).requiresManualRouting,true);assert.deepEqual(rpcCalls,[{name:'assign_report_organization',args:{p_report_id:report}}]);
 console.log('PASS: message APIs deny executor access before generation/mutation; forged organization rejected; caller DB retained; contacts scoped; routing ignores client organization/category and reports ambiguous assignment.');
})().catch(e=>{console.error(e);process.exitCode=1;});
