const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
let state,index;
const code=ts.transpileModule(fs.readFileSync('components/report-claim.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const m={exports:{}};
new Function('exports','require','module',code)(m.exports,name=>name==='react'?{...React,useState:()=>[state[index++],()=>{}],useCallback:f=>f,useEffect:()=>{}}:name==='@/lib/supabase-client'?{}:name==='@/components/ui/button'?{Button:props=>React.createElement('button',props)}:require(name),m);
function render(access){state=[access,false,''];index=0;return renderToStaticMarkup(React.createElement(m.exports.ReportClaim,{reportId:'report'}));}
assert(render({can_claim:true,can_operate:false,claimed_elsewhere:false}).includes('Взять в работу'));
const lost=render({can_claim:false,can_operate:false,claimed_elsewhere:true});assert(!lost.includes('Взять в работу'));assert(lost.includes('Задачу уже взяла другая организация'));
assert(render({can_claim:false,can_operate:true,claimed_elsewhere:false,legacy_assignment:true}).includes('Прежнее назначение'));
assert(!render(null).includes('Взять в работу'));
console.log('PASS: eligible claim action, lost-race copy, legacy assignment label, unavailable access fails closed.');
