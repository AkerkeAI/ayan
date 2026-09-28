const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
let auth,states,index;
function compile(file,overrides={}) {
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};new Function('exports','require','module',code)(m.exports,n=>overrides[n]||require(n),m);return m.exports;
}
const types=compile('lib/resolutions/types.ts');
const {ResolutionSection}=compile('components/resolution-section.tsx',{
 react:{...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}},
 '@/lib/auth-context':{useAuth:()=>auth},
 '@/lib/supabase-client':{supabase:{storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:'https://example.invalid/image.png'}})})}}},
 '@/lib/supporter-token':{getSupporterToken:()=> 'test-token'},
 '@/lib/resolutions/types':types,
 '@/components/evidence-capture':{EvidenceCapture:()=>null},
 '@/components/evidence-trust':{EvidenceTrust:()=>null,RejectEvidence:()=>React.createElement('button',null,'Проблема не решена / Повторно открыть')},
 '@/lib/resolutions/capture':{},
});
function render(role,author='other',state='needs_review',reviewedAt=null){
 auth={user:{id:'self'},isDeveloper:role==='developer',isOperator:role==='operator'};index=0;
 states=[[{id:'resolution',submitted_by:author,submitted_at:'2026-09-26',state,reviewed_at:reviewedAt,note:'Работы выполнены',after_photo_path:'test.png',ai_result:{likely_resolved:false,confidence:0.2,observations:['Требуется проверка'],requires_human_review:true}}],false,'','',null,false,false,[]];
 return renderToStaticMarkup(React.createElement(ResolutionSection,{report:{id:'report',status:state==='verified'?'resolved':'in_progress',photoUrl:'https://example.invalid/before.jpg'},isOperator:role==='operator',onChanged:async()=>{}}));
}
const operator=render('operator');assert(!operator.includes('>Подтвердить решение</button>'));assert(operator.includes('Решение отправлено на проверку оператору Aýan.'));assert(!operator.includes('20%'));assert(!operator.includes('Уверенность модели'));
const developer=render('developer');assert(developer.includes('20%'));assert(developer.includes('Уверенность модели'));assert(developer.includes('>Подтвердить решение</button>'));assert(developer.includes('Проблема не решена / Повторно открыть'));
const self=render('developer','self');assert(!self.includes('>Подтвердить решение</button>'));assert(self.includes('Это ваши доказательства'));
const resident=render(null);assert(!resident.includes('>Подтвердить решение</button>'));assert(resident.includes('Проблема остаётся'));
assert(types.resolutionLabel({state:'verified',reviewed_at:null}).includes('не зафиксирована'));
console.log('PASS: executor sees submission state without diagnostics; developer sees independent decisions; self-review hidden; anonymous feedback remains; legacy verified is not labelled independent.');

const verifiedResident=render(null,'other','verified','2026-09-28T00:00:00Z');
assert(!verifiedResident.includes('Проблема остаётся'));assert(!verifiedResident.includes('Проблема устранена'));
assert(verifiedResident.includes('Фото выполненных работ'));assert(verifiedResident.includes('Исходное фото проблемы'));assert(verifiedResident.includes('Работы выполнены'));assert(verifiedResident.includes('Проверено:'));
assert(!render('developer','other','verified','2026-09-28T00:00:00Z').includes('Повторно открыть'));
console.log('PASS: verified resident has no feedback/reopen controls; before/after evidence and verification remain; independently verified resolution is final for developer too.');

assert.equal(types.resolutionReviewMessage(null),'Автоматическая проверка недоступна. Решение проверит оператор Aýan.');
assert(types.resolutionReviewMessage({likely_resolved:false,confidence:0.3,observations:[],requires_human_review:true}).startsWith('AI не смог уверенно'));
assert(types.resolutionReviewMessage({likely_resolved:true,confidence:0.95,observations:[],requires_human_review:false}).startsWith('AI считает, что проблема устранена'));
assert(!operator.includes('Оператор не может подтвердить'));
const detail=fs.readFileSync('app/dashboard/reports/[id]/page.tsx','utf8');
assert(/\{isDeveloper && \([\s\S]{0,230}Связь с организацией/.test(detail));
