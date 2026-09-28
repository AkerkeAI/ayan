const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('node:assert/strict');
let client=null;let input;let response;
const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/resolutions/ai.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const output={exports:{}};
new Function('exports','require','module',compiled)(output.exports,(name)=>{
 if(name==='@/lib/category-discovery/gemini-transport') return {categoryContent:async(parts)=>{input=parts;if(response instanceof Error)throw response;return JSON.stringify(response);}};
 if(name==='@/lib/category-discovery/diagnostics')return {safeError:()=>({code:'TEST'})};
 if(name==='./images') return {fetchEvidence:async(url)=>({inlineData:{mimeType:'image/png',data:Buffer.from(url).toString('base64')}})};
 return require(name);
},output);
(async()=>{
 delete process.env.GEMINI_API_KEY;
 const {compareEvidence}=output.exports;
 assert.equal((await compareEvidence('before','after')).requires_human_review,true);
 process.env.GEMINI_API_KEY='test-only';
 assert.equal((await compareEvidence(null,'after')).confidence,0);
 response=new Error('model unavailable');assert.equal((await compareEvidence('before','after')).requires_human_review,true);
 response={likely_resolved:true,confidence:8,observations:[],requires_human_review:false};assert.equal((await compareEvidence('before','after')).confidence,0);
 response={likely_resolved:true,confidence:0.3,observations:['Неясное изображение'],requires_human_review:false};assert.equal((await compareEvidence('before','after')).requires_human_review,true);
 response={likely_resolved:true,confidence:0.95,observations:[],requires_human_review:false};assert.equal((await compareEvidence('before','after')).confidence,0.95);
 assert(input[1].inlineData.data);assert(input[2].inlineData.data);
 console.log('PASS: missing key/photo; model failure; malformed JSON structure; low confidence; inline image bytes.');
})().catch(e=>{console.error(e);process.exitCode=1});
