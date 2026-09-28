const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');const {NextRequest}=require('next/server');const {createHash}=require('node:crypto');
const uid='10000000-0000-4000-8000-000000000001',rid='30000000-0000-4000-8000-000000000001',eid='40000000-0000-4000-8000-000000000001';
let allowed=true,key=true,persistError=false,committed=false,attestation=null,imageCalls=[];
const db={auth:{getUser:async()=>({data:{user:{id:uid}}})},storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:'after'}})})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{photo_url:'before'}})})})}),rpc:async(name)=>{assert.equal(name,'submit_report_resolution');committed=true;return{data:eid,error:null};}};
const writer={rpc:async(name,args)=>{assert(committed);assert.equal(name,'record_resolution_trust');attestation=args;return {error:persistError?{code:'TEST0'}:null};}};
const m={exports:{}};new Function('exports','require','module',ts.transpileModule(fs.readFileSync('app/api/reports/[id]/resolutions/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m.exports,n=>{
 if(n==='@/lib/server/authorization')return {requestDatabase:()=>db,hasRole:async()=>allowed,canOperateReport:async()=>allowed,advisoryDatabase:()=>key?writer:null};
 if(n==='@/lib/resolutions/images')return{fetchEvidence:async url=>{imageCalls.push(url);return{inlineData:{data:Buffer.from(url+' bytes').toString('base64'),mimeType:'image/jpeg'}}}};
 if(n==='@/lib/resolutions/ai')return{};if(n==='@/lib/category-discovery/diagnostics')return{safeError:()=>({code:'TEST0'})};return require(n);
},m);
const post=body=>m.exports.POST(new NextRequest('http://localhost/api/test',{method:'POST',body:JSON.stringify(body)}),{params:{id:rid}});
(async()=>{
 const body={action:'submit',note:'repair done',photoPath:`${uid}/${rid}/a.jpg`,signals:{source:'file',gps:{latitude:43,longitude:51,accuracy:2000,timestamp:Date.now()},photoTime:Date.now()}};
 const noGPS=JSON.parse(JSON.stringify(body));delete noGPS.signals.gps;assert.equal((await post(noGPS)).status,400);assert.equal(committed,false);
 const stale=JSON.parse(JSON.stringify(body));stale.signals.gps.timestamp=Date.now()-180000;assert.equal((await post(stale)).status,400);assert.equal(imageCalls.length,0);
 allowed=false;assert.equal((await post(body)).status,403);assert.equal(committed,false);assert.equal(imageCalls.length,0);allowed=true;
 assert.equal((await post(body)).status,200);assert.deepEqual(imageCalls,['after','before']);assert.equal(attestation.p_hash,createHash('sha256').update('after bytes').digest('hex'));assert.equal(attestation.p_before_hash,createHash('sha256').update('before bytes').digest('hex'));
 persistError=true;committed=false;assert.equal((await post(body)).status,200);assert(committed);
 key=false;committed=false;assert.equal((await post(body)).status,200);assert(committed);
 assert.equal((await post({action:'reopen',resolutionId:eid})).status,400);
 console.log('PASS: submission authorization; hashes from actual stored bytes; trusted write only after commit; server/key failures preserve submission; rejection reason mandatory.');
})().catch(e=>{console.error(e);process.exitCode=1});
