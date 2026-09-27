const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
let mode='zero',calls=[];
const summary={total_reports:'0',active_reports:0,verified_resolved:0,reopened_reports:0,total_supports:0,detected_hotspots:0,avg_resolution_hours:0,median_resolution_hours:null};
const db={rpc:async(name,args)=>{
 calls.push({name,args});
 if(mode==='error')return {data:null,error:{code:'42883',message:'SQL failure'}};
 if(mode==='null')return {data:null,error:null};
 if(name==='get_city_intelligence_summary')return {data:mode==='missing'?[]:[summary],error:null};
 return {data:[],error:null};
}};
const code=ts.transpileModule(fs.readFileSync('lib/analytics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={exports:{}};new Function('exports','require','module',code)(mod.exports,()=>({supabase:db}),mod);
(async()=>{
 const data=await mod.exports.fetchAnalytics(null,'water');
 assert.equal(data.kpis.total_reports,0);assert.equal(data.kpis.avg_resolution_hours,0);
 assert.equal(mod.exports.formatResolutionTime(0),'0 мин');
 assert(calls.every(c=>c.args.p_days_filter===null&&c.args.p_category==='water'));
 for(mode of ['error','null','missing'])await assert.rejects(mod.exports.fetchAnalytics(30,null));
 console.log('PASS: RPC failure/malformed/missing response is not empty success; all-time NULL preserved; category applied to all requests; zero-hour resolution preserved.');
})().catch(e=>{console.error(e);process.exitCode=1});
