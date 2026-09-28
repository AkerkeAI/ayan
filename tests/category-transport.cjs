const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const code=ts.transpileModule(fs.readFileSync('lib/category-discovery/gemini-transport.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
process.env.GEMINI_API_KEY='test-only-secret';
async function run(status,payload,timeout=false){
 let transmitted;
 const m={exports:{}};
 const request=(url,options,callback)=>{
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');assert.equal(options.headers['x-goog-api-key'],'test-only-secret');
  const req=new EventEmitter();req.destroy=err=>queueMicrotask(()=>req.emit('error',err));
  req.end=body=>{transmitted=JSON.parse(body);assert.equal(options.headers['Content-Length'],Buffer.byteLength(body));if(timeout)return;queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;callback(res);res.emit('data',Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload)));res.emit('end');});};return req;
 };
 new Function('exports','require','module','setTimeout','clearTimeout',code)(m.exports,n=>n==='node:https'?{request}:require(n),m,timeout?(fn,ms)=>{assert.equal(ms,35000);queueMicrotask(fn);return 0;}:setTimeout,clearTimeout);
 const pending=m.exports.categoryContent([{text:'Описание'},{inlineData:{mimeType:'image/jpeg',data:'real-image-base64'}}],{temperature:0});
 return {pending,body:()=>transmitted};
}
(async()=>{
 const good=await run(200,{candidates:[{finishReason:'STOP',content:{parts:[{text:'private thought',thought:true},{text:'{"valid":true}'}]}}]});assert.equal(await good.pending,'{"valid":true}');assert.equal(good.body().contents[0].parts[1].inlineData.data,'real-image-base64');
 const bad=await run(401,{error:{message:'never log test-only-secret',details:[{reason:'ACCESS_TOKEN_TYPE_UNSUPPORTED'}]}});await assert.rejects(bad.pending,e=>e.status===401&&e.errorDetails[0].reason==='ACCESS_TOKEN_TYPE_UNSUPPORTED'&&!e.message.includes('test-only-secret'));
 const nonJson=await run(503,'upstream unavailable');await assert.rejects(nonJson.pending,e=>e.status===503);
 for(const payload of [{candidates:[{finishReason:'MAX_TOKENS'}]},{}]){const r=await run(200,payload);await assert.rejects(r.pending);}
 const timed=await run(200,{},true);await assert.rejects(timed.pending,e=>e.name==='TimeoutError');
 console.log('PASS: native HTTPS sends exact parts/UTF-8 content length; structured text extraction; HTTP errors, incomplete/empty responses and deadline fail safely; no SDK message/secret leakage.');
})().catch(e=>{console.error(e);process.exitCode=1});
