const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
const {NextRequest}=require('next/server');
function load(file,mocks={}) {const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const m={exports:{}};new Function('exports','require','module',code)(m.exports,name=>name in mocks?mocks[name]:name==='./diagnostics'?load('lib/category-discovery/diagnostics.ts'):require(name),m);return m.exports;}
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM7sAAAAASUVORK5CYII=','base64');
const url='https://project.supabase.co/storage/v1/object/public/report-images/submitted.png';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://project.supabase.co';
let calls=0,downloaded=0,output={matches_existing_category:true,existing_category:'roads',suggested_new_category:null,confidence:.95,reason:'Повреждён асфальт'},enabled=true,fail=false;
const catalog=[{key:'roads',name:'Дороги'}];
const client={getGenerativeModel(config){assert.equal(config.generationConfig.responseMimeType,'application/json');assert.equal(config.generationConfig.thinkingConfig.thinkingBudget,0);assert.deepEqual(config.generationConfig.responseSchema.properties.existing_category.enum,['roads']);return {generateContent:async(parts)=>{calls++;assert.ok(parts[0].text.includes('Описание жителя'));assert.equal(parts[1].inlineData.mimeType,'image/png');assert.deepEqual(Buffer.from(parts[1].inlineData.data,'base64'),image);if(fail)throw {status:401,errorDetails:[{reason:'ACCESS_TOKEN_TYPE_UNSUPPORTED'}],message:'secret raw SDK payload'};return {response:{text:()=>typeof output==='string'?output:JSON.stringify(output)}};}};}};
const ai=load('lib/category-discovery/ai.ts',{'./gemini-transport':{categoryContent:async(parts,config)=>(await client.getGenerativeModel({generationConfig:config}).generateContent(parts)).response.text()},'@/lib/gemini-config':{getGeminiClient:()=>enabled?client:null},'@/lib/resolutions/images':load('lib/resolutions/images.ts')});
const okFetch=async(target,options)=>{downloaded++;assert.equal(String(target),url);assert.equal(options.redirect,'error');return new Response(image,{headers:{'content-type':'image/png'}});};
global.fetch=okFetch;
(async()=>{
 const discover=()=>ai.discoverCategory('Описание жителя',url,catalog);
 assert.equal((await discover()).existing_category,'roads');assert.equal(calls,1);assert.equal(downloaded,1);
 output={...output,confidence:.4};assert.equal((await discover()).confidence,.4);
 output={...output,existing_category:'invented'};assert.equal(await discover(),null);
 output='not JSON';assert.equal(await discover(),null);
 fail=true;const events=[];assert.equal(await ai.discoverCategory('Описание жителя',url,catalog,e=>events.push(e)),null);assert.ok(events.some(e=>e.stage==='gemini'&&e.status==='failed'&&e.httpStatus===401&&e.code==='ACCESS_TOKEN_TYPE_UNSUPPORTED'));assert.ok(!JSON.stringify(events).includes('secret'));fail=false;enabled=false;const count=calls;assert.equal(await discover(),null);assert.equal(calls,count);enabled=true;
 assert.equal(await ai.discoverCategory('Описание жителя',null,catalog),null);
 for(const bad of ['https://evil.invalid/x.png','http://project.supabase.co/storage/v1/object/public/report-images/a.png','https://project.supabase.co/storage/v1/object/public/resolution-images/a.png'])await assert.rejects(ai.reportImage(bad));
 global.fetch=async()=>new Response('not image',{headers:{'content-type':'image/png'}});assert.equal(await discover(),null);
 global.fetch=async()=>new Response(image,{headers:{'content-type':'image/png','content-length':String(11*1024*1024)}});assert.equal(await discover(),null);
 global.fetch=okFetch;
 let claimed=false,processed=0,saved=null;const db={rpc:async(name,args)=>{if(name==='claim_category_discovery'){if(claimed)return {data:null};claimed=true;return {data:{description:'stored description',photo_url:url}};}saved=args.p_result;return {data:null};},from:()=>({select(){return this},eq(){return this},neq:async()=>({data:catalog})})};
 const process=load('lib/category-discovery/process.ts',{'@/lib/server/authorization':{advisoryDatabase:()=>db},'./ai':{discoverCategory:async(description,photo,options)=>{processed++;assert.equal(description,'stored description');assert.equal(photo,url);assert.deepEqual(options,catalog);return {confidence:.95};}}}).processOtherCategory;
 await process('id');await process('id');assert.equal(processed,1);assert.equal(saved.confidence,.95);
 const noKey=load('lib/category-discovery/process.ts',{'@/lib/server/authorization':{advisoryDatabase:()=>null},'./ai':{discoverCategory:()=>{throw Error('must not call')}}}).processOtherCategory;assert.equal(await noKey('id'),'failed');
 const id='30000000-0000-4000-8000-000000000001';let attempts=0,endpointStatus='completed';
 const endpoint=load('app/api/reports/[id]/category-discovery/route.ts',{'@/lib/category-discovery/process':{processOtherCategory:async()=>{attempts++;return endpointStatus;}}});assert.equal(endpoint.GET,undefined);
 const request=(path,body,origin)=>new NextRequest('https://ayan.example'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(origin?{origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await endpoint.POST(request('/api/reports/'+id+'/category-discovery',{},'https://evil.invalid'),{params:{id}})).status,403);assert.equal(attempts,0);
 assert.equal((await endpoint.POST(request('/api/reports/'+id+'/category-discovery',{},'https://ayan.example'),{params:{id}})).status,200);assert.equal(attempts,1);
 endpointStatus='failed';const unavailable=await endpoint.POST(request('/api/reports/'+id+'/category-discovery',{},'https://ayan.example'),{params:{id}});assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{success:false,classification:'unavailable'});
 let allowed=false,writes=0;const authDb={rpc:async()=>{writes++;return {error:null}}};
 const review=load('app/api/category-suggestions/route.ts',{'@/lib/server/authorization':{requestDatabase:()=>authDb,hasRole:async(_,r)=>allowed&&r==='developer'}});
 for(const method of ['GET','POST'])assert.equal((await review[method](request('/api/category-suggestions',{reportId:id,decision:'accept'}))).status,403);assert.equal(writes,0);
 allowed=true;assert.equal((await review.POST(request('/api/category-suggestions',{reportId:id,decision:'accept',name:'Озеленение'}))).status,200);assert.equal(writes,1);
 assert.equal((await review.POST(request('/api/category-suggestions',{reportId:id,decision:'accept',role:'developer'}))).status,400);assert.equal(writes,1);
 const recorded=[];const quietDiagnostics={...load('lib/category-discovery/diagnostics.ts'),reporter:()=>event=>recorded.push(event)};
 for(const failingStage of ['claim','catalog','gemini','persist']) {
  let persisted=false,aiCalls=0;
  const failingDb={rpc:async(name,args)=>{
   if(name==='claim_category_discovery')return failingStage==='claim'?{error:{code:'PGRST202',message:'secret'}}:{data:{description:'stored',photo_url:url}};
   persisted=true;if(failingStage==='catalog'||failingStage==='gemini')assert.equal(args.p_result,null);
   return failingStage==='persist'?{error:{code:'42501',message:'secret'}}:{error:null};
  },from:()=>({select(){return this},eq(){return this},neq:async()=>failingStage==='catalog'?{error:{code:'42501',message:'secret'}}:{data:catalog}})};
  const handler=load('lib/category-discovery/process.ts',{'./diagnostics':quietDiagnostics,'@/lib/server/authorization':{advisoryDatabase:()=>failingDb},'./ai':{discoverCategory:async()=>{aiCalls++;return failingStage==='gemini'?null:{confidence:.95};}}}).processOtherCategory;
  assert.equal(await handler(id),'failed');assert.equal(persisted,failingStage!=='claim');if(failingStage==='claim'||failingStage==='catalog')assert.equal(aiCalls,0);
 }
 assert.ok(recorded.some(e=>e.stage==='claim'&&e.status==='failed'&&e.code==='PGRST202'));
 assert.ok(recorded.some(e=>e.stage==='persist'&&e.status==='failed'&&e.code==='42501'));assert.ok(!JSON.stringify(recorded).includes('secret'));
 const diagnostics=load('lib/category-discovery/diagnostics.ts');assert.equal(diagnostics.safeError(new (require('@google/generative-ai').GoogleGenerativeAIAbortError)('secret timeout message')).code,'TIMEOUT');const authError={status:401,errorDetails:[{reason:'ACCESS_TOKEN_TYPE_UNSUPPORTED',metadata:{key:'secret'}}],message:'secret raw SDK payload'};assert.deepEqual(diagnostics.safeError(authError),{code:'ACCESS_TOKEN_TYPE_UNSUPPORTED',httpStatus:401});assert.ok(!JSON.stringify(diagnostics.safeError(authError)).includes('secret'));
 console.log('PASS: Gemini receives exact uploaded PNG bytes + description; structured validation and failures; image origin/MIME/size restrictions; atomic single processing; missing service key safe; POST-only submission endpoint; developer API gate.');
})().catch(e=>{console.error(e);process.exitCode=1});
