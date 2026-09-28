"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {ExternalNotifications} from '@/components/external-notifications';
import Link from 'next/link';
import {supabase} from '@/lib/supabase-client';
import {useAuth} from '@/lib/auth-context';
type Notice={id:string;report_id:string;event_type:string;title:string;body:string|null;created_at:string;read_at:string|null};
export function NotificationLink({main=false,onClick}:{main?:boolean;onClick?:()=>void}={}){
 const {user,isOperator,isDeveloper,organizationId}=useAuth();const [count,setCount]=useState(0);
 useEffect(()=>{
  let live=true;setCount(0);
  if(!user||(!isOperator&&!isDeveloper))return;
  async function load(){const {count,error}=await supabase.from('staff_notifications').select('id',{count:'exact',head:true}).is('read_at',null);if(live&&!error)setCount(count||0);}
  void load();const timer=setInterval(()=>void load(),30000);window.addEventListener('focus',load);window.addEventListener('staff-notification-read',load);
  return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('staff-notification-read',load);};
 },[user?.id,isOperator,isDeveloper,organizationId]);
 if(!isOperator&&!isDeveloper)return null;
 return <Link href="/dashboard/notifications" onClick={onClick} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${main?'text-navy hover:bg-muted':'text-white hover:bg-white/10'}`}>Уведомления{count>0&&<span aria-label={`Непрочитанных: ${count}`} className="rounded-full bg-white/20 px-2">{count}</span>}</Link>;
}
export function StaffNotifications(){
 const {user,isOperator,isDeveloper,organizationId,isLoading}=useAuth();
 const revision=useRef(0);
 const [items,setItems]=useState<Notice[]>([]),[error,setError]=useState(''),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[more,setMore]=useState(false);
 const load=useCallback(async()=>{
  if(!user||(!isOperator&&!isDeveloper))return;
  const run=++revision.current;
  const {data,error}=await supabase.from('staff_notifications').select('id,report_id,event_type,title,body,created_at,read_at').order('created_at',{ascending:false}).order('id').range(page*30,page*30+30);
  if(run!==revision.current)return;
  if(error){setItems([]);setError('Не удалось загрузить уведомления. Проверьте подключение и применение миграции Phase 5D/5E.');return;}
  setError('');setMore((data?.length||0)>30);setItems((data||[]).slice(0,30));
 },[user?.id,isOperator,isDeveloper,organizationId,page]);
 useEffect(()=>{setItems([]);void load();const timer=setInterval(()=>void load(),30000);window.addEventListener('focus',load);return()=>{revision.current++;clearInterval(timer);window.removeEventListener('focus',load);};},[load]);
 async function read(item:Notice){setBusy(true);const {error}=await supabase.rpc('set_notification_read',{p_id:item.id,p_read:!item.read_at});if(error)setError('Не удалось изменить отметку. Обновите страницу.');else {await load();window.dispatchEvent(new Event('staff-notification-read'));}setBusy(false);}
 if(isLoading||(!isOperator&&!isDeveloper))return <p>{isLoading?'Проверка доступа…':'Уведомления доступны только сотрудникам.'}</p>;
 return <section className="space-y-4"><h1 className="text-2xl font-bold">Уведомления</h1><p className="text-sm text-muted-foreground">Обновляются каждые 30 секунд. Доступ к действиям проверяется при открытии обращения.</p>
 {error&&<p role="alert">{error}</p>}<button className="rounded border px-3 py-2" onClick={()=>void load()}>Обновить</button>
 {!error&&!items.length&&<p>Уведомлений пока нет.</p>}
 {items.map(item=><article key={item.id} className={`space-y-2 rounded-xl border p-4 ${item.read_at?'bg-white':'bg-blue-50'}`}>
 <h2 className="font-semibold">{!item.read_at&&'● '}{item.title}</h2>{item.body&&<p className="whitespace-pre-wrap break-words">{item.body}</p>}
 <p className="text-xs">{new Date(item.created_at).toLocaleString('ru-RU')}</p>
 <div className="flex flex-wrap gap-4"><Link className="underline" href={isDeveloper&&['evidence_submitted','evidence_rejected','resolution_verified','review_exception'].includes(item.event_type)?`/dashboard/review/${item.report_id}`:`/dashboard/reports/${item.report_id}`}>Открыть обращение</Link><button disabled={busy} className="underline" onClick={()=>void read(item)}>{item.read_at?'Отметить непрочитанным':'Отметить прочитанным'}</button></div>
 </article>)}
 <div className="flex gap-3"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Назад</button><button disabled={!more} onClick={()=>setPage(p=>p+1)}>Далее</button></div>{isDeveloper&&<ExternalNotifications/>}</section>;
}
