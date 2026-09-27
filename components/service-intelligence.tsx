'use client';
import { useEffect,useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import type { TimeFilter } from '@/lib/analytics';
import { formatResolutionTime } from '@/lib/analytics';
import { getCategoryLabel } from '@/lib/categories';
import { STATUS_LABELS,type ReportStatus,type ReportCategory } from '@/lib/types';
import { fetchServicePerformance,fetchIntelligenceReports,systemicReasons,type SystemicData,type ServiceData,type ReportScope,type ReportPage } from '@/lib/systemic-intelligence';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';

export type SystemicState = {status:'loading'} | {status:'error'} | {status:'ready';data:SystemicData};
const date=(s:string)=>new Date(s).toLocaleDateString('ru-RU',{timeZone:'Asia/Aqtau'});
export function ServiceIntelligence({days,category,systemic,onRetry,onFocus}:{days:TimeFilter;category:string|null;systemic:SystemicState;onRetry:()=>void;onFocus:(id:string)=>void}) {
 const {isDeveloper,organizationId}=useAuth();
 const [service,setService]=useState<{status:'loading'}|{status:'error'}|{status:'ready';data:ServiceData}>({status:'loading'});
 const [retry,setRetry]=useState(0);
 const [scope,setScope]=useState<{title:string;filter:ReportScope}|null>(null);
 useEffect(()=>{
  let active=true;setService({status:'loading'});setScope(null);
  fetchServicePerformance(days,category).then(data=>{if(active)setService({status:'ready',data});}).catch(()=>{if(active)setService({status:'error'});});
  return()=>{active=false;};
 },[days,category,retry]);
 return <>
  <section className="rounded-xl border bg-white p-4 sm:p-5" aria-labelledby="systemic-title">
   <h2 id="systemic-title" className="font-semibold text-navy">Системные проблемы</h2>
   <p className="mt-1 text-xs text-slate-500">Проблемы, которые повторяются в одном месте или возвращаются после решения.</p>
   {systemic.status==='loading' && <p role="status" className="mt-3 text-sm text-slate-500">Загрузка системных признаков…</p>}
   {systemic.status==='error' && <ErrorState onRetry={onRetry}/>}
   {systemic.status==='ready' && <>
    <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Как это определяется?</summary><p className="mt-2">Учитываем несколько близких обращений, их повторение со временем, длительное ожидание решения и повторное открытие. Одних поддержек +1 недостаточно.</p></details>
    {systemic.data.issues.length===0 ? <p className="mt-4 text-sm text-slate-600">Системных проблем пока не выявлено.</p> :
     <div className="mt-4 grid gap-3 xl:grid-cols-2">{systemic.data.issues.map(issue=>{
      const reasons=systemicReasons(issue,systemic.data.config);
      return <article key={issue.hotspot_id} className="min-w-0 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4">
       <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-navy">{getCategoryLabel(issue.category as ReportCategory)}</h3><span className="rounded-full border border-indigo-200 px-2 py-1 text-[11px] text-indigo-800">Системная проблема</span></div>
       <p className="mt-2 text-xs text-slate-500">Примерный центр: {issue.center_lat.toFixed(4)}, {issue.center_lng.toFixed(4)}</p>
       <p className="mt-2 text-sm">{issue.report_count} обращений · {issue.support_count} поддержек +1 · Активно: {issue.active_count}</p>
       <p className="mt-1 text-xs text-slate-600">Подтверждено: {issue.verified_count} · Повторно открыто: {issue.reopened_count}</p>
       <p className="mt-1 text-xs text-slate-500">{date(issue.first_observed)} — {date(issue.latest_observed)} · Между первым и последним обращением: {Math.floor(issue.span_days)} дн</p>
       <p className="mt-1 text-xs text-slate-500">Служба: {issue.organization_name??'Единая ответственная служба не установлена'}</p>
       <h4 className="mt-3 text-xs font-semibold text-navy">Почему Aýan выделил эту проблему</h4>
       <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">{reasons.slice(0,3).map(reason=><li key={reason}>{reason}</li>)}</ul>
       {reasons.length>3 && <details className="mt-2 text-xs text-slate-600"><summary>Все признаки</summary><ul className="mt-2 list-disc space-y-1 pl-4">{reasons.slice(3).map(reason=><li key={reason}>{reason}</li>)}</ul></details>}
       <div className="mt-4 flex flex-wrap gap-2"><button className="rounded-lg border bg-white px-3 py-2 text-xs text-primary" onClick={()=>onFocus(issue.hotspot_id)}>Показать на карте</button>
        <button className="rounded-lg border bg-white px-3 py-2 text-xs text-primary" onClick={()=>setScope({title:getCategoryLabel(issue.category as ReportCategory),filter:{hotspot_id:issue.hotspot_id}})}>Посмотреть обращения</button></div>
      </article>;
     })}</div>}
   </>}
  </section>
  <section className="rounded-xl border bg-white p-4 sm:p-5" aria-labelledby="service-title">
   <h2 id="service-title" className="font-semibold text-navy">Работа городских служб</h2>
   <p className="mt-1 text-xs text-slate-500">Здесь показано, как организации работают с обращениями, назначенными именно им. Решения учитываются после независимой проверки.</p>
   {service.status==='loading' && <p role="status" className="mt-3 text-sm text-slate-500">Загрузка показателей служб…</p>}
   {service.status==='error' && <ErrorState onRetry={()=>setRetry(n=>n+1)}/>}
   {service.status==='ready' && <>
    <>{service.data.unassigned_count>0 && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{service.data.unassigned_count} обращений пока не назначены организации.</p>}<details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Как читать показатели?</summary><p className="mt-2">Доля подтверждённо решённых считается от всех назначенных обращений выбранного периода и категории. Для времени решения нужно минимум {service.data.config.min_resolution_samples} подтверждённых решения. Службы перечислены по алфавиту, без рейтинга.</p></details></>
    {service.data.organizations.length===0 ? <p className="mt-4 text-sm text-slate-600">По выбранным фильтрам у служб пока нет назначенных обращений.</p> :
     <div className="mt-4 divide-y">{service.data.organizations.map(org=><article key={org.organization_id} className="min-w-0 py-4 first:pt-0 last:pb-0">
      <button disabled={!isDeveloper && organizationId!==org.organization_id} onClick={()=>setScope({title:org.organization_name,filter:{organization_id:org.organization_id}})} className="text-left text-sm font-semibold text-primary underline-offset-4 enabled:hover:underline disabled:cursor-default disabled:text-navy">{org.organization_name}</button>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
       {[['Назначено',org.assigned_count],['Активно',org.active_count],['Подтверждено',org.verified_count],['Повторно открыто',org.reopened_count],['Доля подтверждённо решённых',`${org.verified_share.toLocaleString('ru-RU')}%`],['Медианное время',org.median_resolution_hours===null?'Недостаточно данных':formatResolutionTime(org.median_resolution_hours)]].map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-sm font-semibold text-navy">{value}</dd></div>)}
      </dl>
      <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer">Детали расчёта</summary><p className="mt-2">Подтверждений оператора Aýan за всю историю выбранных обращений: {org.verification_decisions}. Решений «повторно открыть»: {org.reopen_decisions}. Они могут относиться к одному обращению в разных циклах.</p>
       <p className="mt-1">Обращений в выборке времени: {org.resolution_samples}. Среднее: {org.avg_resolution_hours===null?'Недостаточно данных':formatResolutionTime(org.avg_resolution_hours)}.</p>
       <p className="mt-1">Время от создания до действующего независимого подтверждения. Открытые повторно исключены; после нового подтверждения учитывается только последний действующий цикл. Назначение отражает текущую службу, а не историю ответственности.</p>
      </details>
     </article>)}</div>}
   </>}
  </section>
  {scope && <ReportsDialog key={`${days}:${category}:${scope.filter.hotspot_id??scope.filter.organization_id}`} days={days} category={category} scope={scope.filter} title={scope.title} onClose={()=>setScope(null)}/>}
 </>;
}
function ErrorState({onRetry}:{onRetry:()=>void}) {
 return <div role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>Не удалось загрузить этот раздел аналитики. Это не означает отсутствие данных.</p><button className="mt-2 font-medium text-primary" onClick={onRetry}>Повторить загрузку</button></div>;
}
function ReportsDialog({days,category,scope,title,onClose}:{days:TimeFilter;category:string|null;scope:ReportScope;title:string;onClose:()=>void}) {
 const [offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
 const [state,setState]=useState<{status:'loading'}|{status:'error'}|{status:'ready';data:ReportPage}>({status:'loading'});
 useEffect(()=>{let active=true;setState({status:'loading'});
  fetchIntelligenceReports(days,category,scope,offset).then(data=>{if(active)setState({status:'ready',data});}).catch(()=>{if(active)setState({status:'error'});});
  return()=>{active=false;};
 },[days,category,scope,offset,retry]);
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[85dvh] max-w-xl overflow-y-auto">
  <DialogHeader><DialogTitle>{title}: обращения</DialogTitle><DialogDescription>Обращения за выбранный период и по выбранной категории, доступные вашей рабочей роли.</DialogDescription></DialogHeader>
  {state.status==='loading' && <p role="status">Загрузка…</p>}
  {state.status==='error' && <ErrorState onRetry={()=>setRetry(n=>n+1)}/>}
  {state.status==='ready' && <><p className="text-xs text-slate-500">Всего: {state.data.total}</p><ul className="divide-y">{state.data.reports.map(r=><li key={r.id} className="py-3"><Link className="text-sm text-primary" href={`/dashboard/reports/${r.id}`}>#{r.id.slice(0,8)} · {getCategoryLabel(r.category as ReportCategory)}</Link><p className="mt-1 text-xs text-slate-500">{STATUS_LABELS[r.status as ReportStatus]} · {date(r.created_at)}</p></li>)}</ul>
  {state.data.total===0 && <p>Обращений в выбранной группе нет.</p>}
  <div className="flex justify-between gap-3"><button disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-50))} className="text-sm disabled:opacity-40">Назад</button><button disabled={offset+50>=state.data.total} onClick={()=>setOffset(n=>n+50)} className="text-sm disabled:opacity-40">Далее</button></div></>}
 </DialogContent></Dialog>;
}
