"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {supabase} from '@/lib/supabase-client';
type Job={id:string;report_id:string;event_type:string;channel:string;status:string;attempts:number;last_code:string|null;created_at:string;sent_at:string|null};
const labels:Record<string,string>={pending:'Ожидает отправки',processing:'Отправляется',retry:'Повтор запланирован',blocked:'Нужна настройка / исправление',uncertain:'Доставка неизвестна — сверьте с провайдером',sent:'Провайдер принял сообщение',cancelled:'Уведомление утратило актуальность'};
const codes:Record<string,string>={UNSUPPORTED_CHANNEL:'Канал не подключён. WhatsApp автоматически не отправляется.',PROVIDER_NOT_CONFIGURED:'Не настроен Resend API.',INVALID_EMAIL_CONFIGURATION:'Проверьте адрес получателя и подтверждённого отправителя.',SITE_URL_NOT_CONFIGURED:'Не настроен адрес сайта для ссылок.',RECONCILE_REQUIRED:'Сначала проверьте доставку у провайдера; автоматический повтор остановлен.',CONTACT_CHANGED:'Контакт организации изменился.',ORGANIZATION_INACTIVE:'Организация неактивна.'};
export function ExternalNotifications(){
 const [configuration,setConfiguration]=useState(''),[actionError,setActionError]=useState('');
 const [items,setItems]=useState<Job[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(0),[more,setMore]=useState(false);
 async function headers(){const {data:{session}}=await supabase.auth.getSession();return{Authorization:`Bearer ${session?.access_token||''}`,'Content-Type':'application/json'};}
 useEffect(()=>{let live=true;setItems([]);
  async function load(){try{const response=await fetch(`/api/notifications/external?page=${page}`,{headers:await headers(),cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);if(live){setItems(data.items);setMore(data.more);setError('');setConfiguration(data.configured&&Object.values(data.configured).every(Boolean)?'':'Автоотправка ещё не настроена полностью. Администратору нужно подключить email, адрес сайта и фоновый обработчик.');}}catch(e){if(live)setError(e instanceof Error?e.message:'Ошибка загрузки');}}
  void load();const timer=setInterval(()=>void load(),30000);return()=>{live=false;clearInterval(timer);};
 },[page,busy]);
 async function retry(id:string){setActionError('');setBusy(true);try{const response=await fetch('/api/notifications/external',{method:'POST',headers:await headers(),body:JSON.stringify({id})});const data=await response.json();if(!response.ok)throw Error(data.error);}catch(e){setActionError(e instanceof Error?e.message:'Ошибка повтора');}finally{setBusy(false);}}
 return <section id="external" className="mt-8 space-y-3"><h2 className="text-xl font-semibold">Внешние уведомления</h2><p className="text-sm">Обычные сообщения отправляются автоматически после подключения провайдера и фонового расписания. Здесь — статусы и исключения. Принятие провайдером не означает прочтение получателем.</p>{configuration&&<p role="status">{configuration}</p>}{(error||actionError)&&<p role="alert">{actionError||error}</p>}
 {!items.length&&!error&&<p>Внешних уведомлений пока нет.</p>}
 {items.map(item=><article className="rounded border p-3 space-y-2" key={item.id}><p className="text-xs">ID отправки: {item.id}</p><p>{item.channel} · {labels[item.status]||item.status}</p><p className="text-sm">{item.last_code&&(codes[item.last_code]||`Код: ${item.last_code}`)} · Попыток: {item.attempts}</p><Link className="underline" href={`/dashboard/reports/${item.report_id}`}>Открыть задачу {item.report_id.slice(0,8)}</Link>{item.status==='blocked'&&<button className="ml-3 underline" disabled={busy} onClick={()=>void retry(item.id)}>Повторить после исправления</button>}</article>)}
 <div className="flex gap-4"><button disabled={!page||busy} onClick={()=>setPage(p=>p-1)}>Назад</button><button disabled={!more||busy} onClick={()=>setPage(p=>p+1)}>Далее</button></div></section>;
}
