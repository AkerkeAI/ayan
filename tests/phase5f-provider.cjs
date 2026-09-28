const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,mocks={}){const m={exports:{}};new Function('exports','require','module',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m.exports,n=>mocks[n]||require(n),m);return m.exports;}
const {prepareDelivery,sendEmail,dispatchExternal}=load('lib/messaging/external-delivery.ts');
const job={id:'11111111-1111-4111-8111-111111111111',report_id:'22222222-2222-4222-8222-222222222222',organization_id:'33333333-3333-4333-8333-333333333333',event_type:'task_available',channel:'email',destination:'test@example.invalid',category_name:'Дороги',address:'Тестовый адрес',description:'Яма. пароль: private-secret-token https://user:pass@example.com',reason:null,created_at:'2026-09-28T10:00:00Z',lease_token:'lease',request_payload:null};
(async()=>{
 delete process.env.RESEND_API_KEY;assert.equal(prepareDelivery(job).error,'PROVIDER_NOT_CONFIGURED');
 process.env.RESEND_API_KEY='test-provider-secret';process.env.RESEND_FROM_EMAIL='sender@example.invalid';process.env.AYAN_SITE_URL='https://example.invalid';
 assert.equal(prepareDelivery({...job,channel:'whatsapp'}).error,'UNSUPPORTED_CHANNEL');
 const {payload}=prepareDelivery(job);assert(payload.text.includes('Новая задача'));assert(payload.text.includes(job.report_id));assert(payload.text.includes('Дороги'));assert(payload.text.includes('Тестовый адрес'));assert(payload.text.includes('https://example.invalid/dashboard/reports/'));assert(!payload.text.includes('private-secret-token'));assert(!payload.text.includes('user:pass'));assert(!payload.text.includes(process.env.RESEND_API_KEY));
 const rejected=prepareDelivery({...job,event_type:'evidence_rejected',reason:'Нет результата'});assert(rejected.payload.text.includes('Причина: Нет результата'));
 assert(prepareDelivery({...job,event_type:'claimed_elsewhere'}).payload.text.includes('Действия по этому уведомлению не требуются'));
 assert.equal(prepareDelivery({...job,destination:'bad\r\nBcc: stolen@example.invalid'}).error,'INVALID_EMAIL_CONFIGURATION');
 process.env.AYAN_SITE_URL='http://localhost:3000';assert.equal(prepareDelivery(job).error,'SITE_URL_NOT_CONFIGURED');process.env.AYAN_SITE_URL='https://example.invalid';
 let requests=[];global.fetch=async(url,init)=>{requests.push({url,init});return Response.json({id:job.id});};
 assert.equal((await sendEmail(job.id,payload)).status,'sent');assert.equal(requests[0].url,'https://api.resend.com/emails');assert.equal(requests[0].init.headers['Idempotency-Key'],'ayan-notification/'+job.id);
 await sendEmail(job.id,{text:payload.text,subject:payload.subject,to:payload.to,from:payload.from});assert.equal(requests[0].init.body,requests[1].init.body);
 for(const status of [429,500,503]){global.fetch=async()=>new Response('',{status});assert.equal((await sendEmail(job.id,payload)).status,'retry');}
 global.fetch=async()=>{throw Error('SENSITIVE_PROVIDER_MESSAGE')};assert.equal((await sendEmail(job.id,payload)).code,'PROVIDER_OUTCOME_UNKNOWN');
 global.fetch=async()=>Response.json({message:'no id'});assert.equal((await sendEmail(job.id,payload)).status,'retry');
 global.fetch=async()=>new Response('',{status:401});assert.equal((await sendEmail(job.id,payload)).status,'blocked');
 let sent=0,ack=null,claimed=false;
 const db={rpc:async(name,args)=>{if(name==='claim_external_notification'){if(claimed)return{data:[]};claimed=true;return{data:[job]};}if(name==='begin_external_attempt'){assert.deepEqual(args.p_payload,payload);return{error:null};}if(name==='finish_external_notification'){ack=args;return{error:null};}throw Error(name);}};
 global.fetch=async()=>{sent++;return Response.json({id:job.id});};await dispatchExternal(db);assert.equal(sent,1);assert.equal(ack.p_status,'sent');assert.equal(ack.p_provider_id,job.id);
 claimed=false;job.channel='whatsapp';sent=0;await dispatchExternal(db);assert.equal(sent,0);assert.equal(ack.p_status,'blocked');assert.equal(ack.p_provider_id,null);
 const {NextRequest}=require('next/server');let access=false,workerCalls=0;
 const route=load('app/api/internal/notifications/dispatch/route.ts',{'@/lib/server/authorization':{advisoryDatabase:()=>db},'@/lib/messaging/external-delivery':{dispatchExternal:async()=>{workerCalls++;return{processed:0};}}});
 process.env.CRON_SECRET='x'.repeat(40);
 const post=authorization=>route.POST(new NextRequest('http://localhost/api/internal/notifications/dispatch',{method:'POST',headers:authorization?{authorization}:{}}));
 assert.equal((await post()).status,401);assert.equal((await post('Bearer wrong')).status,401);assert.equal(workerCalls,0);assert.equal((await post('Bearer '+process.env.CRON_SECRET)).status,200);assert.equal(workerCalls,1);
 const external=load('app/api/notifications/external/route.ts',{'@/lib/server/authorization':{requestDatabase:()=>db,hasRole:async()=>access}});
 assert.equal((await external.GET(new NextRequest('http://localhost/api/notifications/external'))).status,403);
 assert.equal((await external.POST(new NextRequest('http://localhost/api/notifications/external',{method:'POST',body:JSON.stringify({id:job.id})}))).status,403);
 console.log('PASS: factual/redacted templates, real fixed-provider HTTP contract, confirmation-only sent, 429/5xx/timeout/malformed responses, stable canonical payload/key, unsupported channels never send, worker authentication and executor exception API denial.');
})().catch(e=>{console.error(e);process.exitCode=1});
