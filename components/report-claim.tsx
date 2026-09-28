"use client";
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
export type ClaimAccess={can_claim:boolean;can_operate:boolean;claimed_elsewhere:boolean;legacy_assignment?:boolean;claimed_at?:string|null};
export function ReportClaim({reportId,onAccess,onChanged}:{reportId:string;onAccess?:(value:boolean)=>void;onChanged?:()=>void}) {
 const [access,setAccess]=useState<ClaimAccess|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async()=>{
  try{const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error();
   const response=await fetch(`/api/reports/${reportId}/claim`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});
   if(!response.ok)throw Error();const data:ClaimAccess=await response.json();setAccess(data);onAccess?.(data.can_operate);
  }catch{setAccess(null);onAccess?.(false);}
 },[reportId,onAccess]);
 useEffect(()=>{
  void load();const timer=setInterval(()=>void load(),5000);
  const channel=supabase.channel(`claim-${reportId}-${Math.random()}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'reports',filter:`id=eq.${reportId}`},()=>{void load();onChanged?.();}).subscribe();
  return()=>{clearInterval(timer);void supabase.removeChannel(channel);};
 },[load,reportId,onChanged]);
 async function claim(){setBusy(true);setError('');try{
  const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Войдите как исполнитель');
  const response=await fetch(`/api/reports/${reportId}/claim`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}});const data=await response.json();if(!response.ok)throw Error(data.error);
  await load();onChanged?.();window.dispatchEvent(new Event('ayan-claims-changed'));
 }catch(e){setError(e instanceof Error?e.message:'Не удалось взять задачу');await load();}finally{setBusy(false);}}
 return <div className="space-y-2 text-sm">
  {access?.can_claim&&<Button disabled={busy} onClick={()=>void claim()}>Взять в работу</Button>}
  {access?.claimed_elsewhere&&<p>Задачу уже взяла другая организация</p>}
  {access?.can_operate&&<p>{access.legacy_assignment?'Прежнее назначение вашей организации':'Задачу взяла ваша организация'}</p>}
  {!access&&<p>Проверка доступа к задаче…</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}
 </div>;
}
