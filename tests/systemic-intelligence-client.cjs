const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function compile(file,mocks){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;const m={exports:{}};new Function('exports','require','module',code)(m.exports,n=>mocks[n]||require(n),m);return m.exports;}
const config={spatial_radius_meters:150,min_distinct_reports:3,recurrence_span_days:7,unresolved_days:14,min_resolution_samples:3};
let calls=[],response={config,issues:[]},error=null;
const client=compile('lib/systemic-intelligence.ts',{'./supabase-client':{supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:response,error};}}}});
(async()=>{
 assert.deepEqual((await client.fetchSystemicIssues(null,'roads')).issues,[]);
 response={config,organizations:[],total_reports:0,unassigned_count:0};assert.equal((await client.fetchServicePerformance(7,'water')).total_reports,0);
 response={total:0,reports:[]};await client.fetchIntelligenceReports(90,null,{organization_id:'org'},50);
 assert.deepEqual(calls.map(c=>c.args),[{p_days_filter:null,p_category:'roads'},{p_days_filter:7,p_category:'water'},{p_days_filter:90,p_category:null,p_hotspot_id:null,p_organization_id:'org',p_offset:50}]);
 for(response of [null,{},[],{config,issues:[{report_count:'3'}]}])await assert.rejects(client.fetchSystemicIssues(null,null));
 error={code:'42883',message:'Missing RPC'};await assert.rejects(client.fetchServicePerformance(null,null));error=null;
 const issue={hotspot_id:'zone',category:'roads',center_lat:43.65,center_lng:51.15,report_count:3,support_count:100,active_count:3,verified_count:0,reopened_count:1,first_observed:'2026-09-01',latest_observed:'2026-09-09',span_days:8,organization_name:null,signals:{time_span:true,reopened:true}};
 assert.equal(client.systemicReasons(issue,config).length,3);assert(!client.systemicReasons(issue,config).join(' ').includes('100'));
 let states,index;
 const ui=compile('components/service-intelligence.tsx',{
  react:{...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}},'next/link':({children,...props})=>React.createElement('a',props,children),
  '@/lib/auth-context':{useAuth:()=>({isDeveloper:false,organizationId:'org'})},'@/lib/analytics':{formatResolutionTime:n=>`${n} ч`},'@/lib/categories':{getCategoryLabel:()=> 'Дороги'},'@/lib/types':{STATUS_LABELS:{}},'@/lib/systemic-intelligence':client,
  '@/components/ui/dialog':{},
 });
 const render=(systemic,service)=>{index=0;states=[service,0,null];return renderToStaticMarkup(React.createElement(ui.ServiceIntelligence,{days:null,category:null,systemic,onRetry:()=>{},onFocus:()=>{}}));};
 let html=render({status:'ready',data:{config,issues:[]}},{status:'ready',data:{config,organizations:[],total_reports:0,unassigned_count:0}});
 assert(html.includes('Системных проблем пока не выявлено'));assert(html.includes('у служб пока нет назначенных обращений'));
 html=render({status:'error'},{status:'error'});assert(html.includes('не означает отсутствие данных'));assert(!html.includes('Системных проблем пока не выявлено'));
 html=render({status:'ready',data:{config,issues:[issue]}},{status:'ready',data:{config,total_reports:1,unassigned_count:0,organizations:[{organization_id:'org',organization_name:'Служба',assigned_count:1,active_count:1,verified_count:0,reopened_count:0,verified_share:0,resolution_samples:0,median_resolution_hours:null,avg_resolution_hours:null,verification_decisions:0,reopen_decisions:0}]}});
 assert(html.includes('Почему Aýan выделил эту проблему'));assert(html.includes('Посмотреть обращения'));assert(html.includes('Недостаточно данных'));assert(html.includes('Единая ответственная служба не установлена'));
 // Behavioral map regression: focus -> reset -> SAME hotspot focus, respecting hook dependencies.
 let refs,refIndex,effects,previous=[],selected=null,flights=0,fits=0;
 const fakeMap={flyTo:()=>flights++,fitBounds:()=>fits++};
 const map=compile('components/heatmap-map.tsx',{react:{useRef:()=>refs[refIndex++],useEffect:(fn,deps)=>effects.push({fn,deps})},leaflet:{default:{latLngBounds:p=>p}},'@/lib/managed-heat-layer':{},'leaflet.heat':{},'leaflet/dist/leaflet.css':{},'./heatmap-map.module.css':{default:{}},'@/lib/categories':{getCategoryLabel:()=> 'Дороги'}}).HeatmapMap;
 const points=[{latitude:43.65,longitude:51.15,intensity:1}],hotspots=[{hotspot_id:'zone',center_lat:43.65,center_lng:51.15},{hotspot_id:'second',center_lat:43.68,center_lng:51.18}];
 const draw=()=>{refIndex=0;effects=[];refs=[{current:null},{current:fakeMap},{current:null},{current:null}];const tree=map({points,hotspots,selected,onSelect:id=>selected=id,onReset:()=>selected=null});const effect=effects[3];if(effect.deps.some((v,i)=>v!==previous[i]))effect.fn();previous=effect.deps;return tree;};
 draw();selected='zone';let tree=draw();assert.equal(flights,1);tree.props.children[1].props.onClick();draw();assert.equal(selected,null);assert.equal(fits,1);selected='zone';draw();assert.equal(flights,2);for(let i=0;i<25;i++){draw().props.children[1].props.onClick();draw();selected='zone';draw();}assert.equal(flights,27);draw().props.children[1].props.onClick();draw();selected='second';draw();assert.equal(flights,28);
 console.log('PASS: 4B clients filter/null/error contracts, factual reasons, honest empty/error/low-sample UI and same-hotspot focus after Show all reset.');
})().catch(e=>{console.error(e);process.exitCode=1;});
