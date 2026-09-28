'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase-client';
export function AnalyticsInsights({days,category}:{days:number|null;category:string|null}){
 const [text,setText]=useState<string|null>(null),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false);
 async function generate(){setBusy(true);setText(null);setAttempted(true);try{
  const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error();
  const response=await fetch('/api/analytics/insights',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({days,category})});
  if(!response.ok)throw Error();setText((await response.json()).text);
 }catch{setText(null);}finally{setBusy(false);}}
 return <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">AI-выводы</h2>
 <p className="mt-1 text-xs text-muted-foreground">Краткое пояснение рассчитанных фактов. Без прогнозов и оценок организаций.</p>
 {text&&<p className="mt-3 text-sm">{text}</p>}
 {attempted&&!busy&&!text&&<p className="mt-3 text-sm">AI-выводы недоступны. Все показатели аналитики остаются доступны.</p>}
 <button disabled={busy} className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void generate()}>{busy?'Подготовка пояснения…':'Сформировать AI-выводы'}</button></section>;
}
