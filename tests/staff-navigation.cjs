const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
let auth={},menu=false;
function load(file,extra={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;const m={exports:{}};new Function('exports','require','module',code)(m.exports,n=>({
 react:{...React,useEffect:()=>{},useMemo:fn=>fn(),useState:initial=>[file.includes('site-header')?menu:initial,()=>{}]},
 'next/link':{default:({children,...props})=>React.createElement('a',props,children)},'next/navigation':{usePathname:()=> '/',useRouter:()=>({replace:()=>{}})},
 '@/lib/auth-context':{useAuth:()=>auth},'@/lib/utils':{cn:(...classes)=>classes.filter(Boolean).join(' ')},...extra,
 }[n]||require(n)),m);return m.exports;}
const notifications=load('components/staff-notifications.tsx',{'@/lib/supabase-client':{supabase:{}},'@/components/external-notifications':{ExternalNotifications:()=>null}});
const Header=load('components/site-header.tsx',{'@/components/staff-notifications':notifications}).SiteHeader;
const Queue=load('app/dashboard/reports/page.tsx',{
 '@/components/report-claim':{ReportClaim:()=>null},'@/lib/supabase-client':{supabase:{}},
 '@/components/dashboard-layout':{DashboardLayout:({children})=>React.createElement('main',null,children)},'@/components/status-badge':{},
 '@/lib/reports':{fetchOperationalReports:()=>{throw Error('Effects not run in static render');}},'@/lib/categories':{},'@/lib/types':{CATEGORY_LABELS:{roads:'Дороги',water:'Вода'},STATUS_LABELS:{}},'@/components/report-card':{},
}).default;
for(menu of [false,true]){
 auth={};let html=renderToStaticMarkup(React.createElement(Header));assert(html.includes('/map'));assert(html.includes('/my-reports'));assert(html.includes('/report'));assert(!html.includes('/dashboard'));assert(!html.includes('/dashboard/notifications'));assert(!html.includes('Выйти'));
 auth={isOperator:true};html=renderToStaticMarkup(React.createElement(Header));for(const route of ['/dashboard','/dashboard/reports','/dashboard/analytics'])assert(html.includes(`href="${route}"`));assert(!html.includes('/dashboard/review'));assert(html.includes('Выйти'));assert(html.includes('/dashboard/notifications'));assert(html.includes('На сайт'));
 auth={isDeveloper:true};html=renderToStaticMarkup(React.createElement(Header));assert(html.includes('/dashboard/review'));assert(html.includes('/dashboard/reports'));assert(!html.includes('/dashboard/analytics'));assert(html.includes('Выйти'));assert(html.includes('/dashboard/notifications'));
}
auth={isOperator:true,organizationId:'own'};let html=renderToStaticMarkup(React.createElement(Queue));assert(!html.includes('Все категории'));assert(html.includes('обращения вашей организации'));assert(html.includes('В работе'));assert(html.includes('Поиск...'));assert(html.includes('Сначала новые'));
auth={isDeveloper:true};html=renderToStaticMarkup(React.createElement(Queue));assert(html.includes('Все категории'));assert(html.includes('Обращения для независимой проверки'));
auth={};assert.equal(renderToStaticMarkup(React.createElement(Queue)),'');
console.log('PASS: desktop/mobile anonymous navigation preserved, role-specific staff links/logout, operator category selector removed, developer selector/status/search/sorting retained.');
