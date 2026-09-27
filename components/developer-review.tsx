'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase-client';
import { rowToReport, ReportRow, CATEGORY_LABELS, STATUS_LABELS } from '@/lib/types';
import { Resolution, resolutionLabel } from '@/lib/resolutions/types';
import { ResolutionSection } from '@/components/resolution-section';
import { DashboardLayout } from '@/components/dashboard-layout';

type ReviewCase = Resolution & {reports:ReportRow};
type Audit = {resolution_id:string;reviewer_user_id:string;reviewed_at:string;decision:string;verification_state:string};
export function DeveloperReview({reportId}:{reportId?:string}) {
  const {isDeveloper,isLoading,user}=useAuth();
  const [cases,setCases]=useState<ReviewCase[]>([]);
  const [reviews,setReviews]=useState<Audit[]>([]);
  const [page,setPage]=useState(0);
  const [more,setMore]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    if (!isDeveloper) return;
    setBusy(true);setError('');
    try {
      const {data:{session}}=await supabase.auth.getSession();
      if (!session) throw new Error('Войдите как оператор Aýan');
      const response=await fetch(`/api/review?${reportId?`reportId=${encodeURIComponent(reportId)}&`:''}page=${page}`,{
        headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',
      });
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      setCases(data.cases);setReviews(data.reviews);setMore(data.hasMore);
    } catch(e) {setCases([]);setReviews([]);setError(e instanceof Error?e.message:'Ошибка загрузки');}
    finally {setBusy(false);}
  },[isDeveloper,reportId,page]);
  useEffect(()=>{void load();},[load]);
  if(isLoading) return <DashboardLayout><p>Проверка доступа…</p></DashboardLayout>;
  if(!isDeveloper) return <DashboardLayout><h1 className="text-xl font-bold">Доступ только для оператора Aýan</h1><p className="mt-3">Войдите через существующую форму входа. Независимую проверку выполняет оператор Aýan.</p></DashboardLayout>;
  const current=cases[0];
  return <DashboardLayout>
    <h1 className="mb-3 text-2xl font-bold text-navy">{reportId?'Независимая проверка решения':'Очередь проверки решений'}</h1>
    <p className="mb-4 text-sm text-muted-foreground">ИИ даёт рекомендацию. Проверяющий самостоятельно сравнивает доказательства; собственные работы проверять запрещено.</p>
    {error&&<p role="alert">{error}</p>}{busy&&<p>Загрузка…</p>}
    {!busy&&!error&&!cases.length&&<p>Нет обращений для проверки.</p>}
    {reportId&&current ? <div className="space-y-4">
      <Link href="/dashboard/review" className="text-primary">← Очередь проверки</Link>
      <div className="rounded-xl border bg-white p-5">
        <h2 className="font-semibold">{CATEGORY_LABELS[current.reports.category]} · {current.report_id.slice(0,8)}</h2>
        <p>{current.reports.address}</p><p className="mt-2">{current.reports.description}</p>
        <p className="mt-2 text-sm">Операционный статус: {STATUS_LABELS[current.reports.status]} · Проверка: {resolutionLabel(current)}</p>
      </div>
      <ResolutionSection report={rowToReport(current.reports)} isOperator={false} onChanged={load}/>
      <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">Журнал независимых решений</h2>
        {!reviews.length&&<p>Независимые решения ещё не зафиксированы.</p>}
        {reviews.map((r,i)=><p key={i} className="mt-2 break-words text-sm">{r.decision==='verify'?'Подтверждено':'Повторно открыто'} · {new Date(r.reviewed_at).toLocaleString('ru-RU')} · UUID проверяющего: {r.reviewer_user_id}</p>)}
      </section>
    </div> : <div className="grid gap-4 md:grid-cols-2">{cases.map(r=><Link key={r.id} href={`/dashboard/review/${r.report_id}`} className="space-y-2 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">{CATEGORY_LABELS[r.reports.category]} · {r.report_id.slice(0,8)}</h2>
      <p className="text-sm">{r.reports.address}</p>
      <div className="grid grid-cols-2 gap-2">{r.reports.photo_url?<img src={r.reports.photo_url} alt="До" className="h-32 w-full object-contain"/>:<p>Исходного фото нет</p>}<img src={supabase.storage.from('resolution-images').getPublicUrl(r.after_photo_path).data.publicUrl} alt="После" className="h-32 w-full object-contain"/></div>
      <p className="text-sm">{resolutionLabel(r)}</p>
      <p className="text-sm">{r.ai_result ? `${r.ai_result.likely_resolved?'ИИ: вероятно устранено':'Изменение не удалось подтвердить по фото'} · ${Math.round(r.ai_result.confidence*100)}%`:'Анализ ИИ отсутствует — ручная проверка'}</p>
      <p className="text-xs">{new Date(r.submitted_at).toLocaleString('ru-RU')}</p>
      {r.submitted_by===user?.id&&<p className="text-sm">Ваши доказательства — требуется другой проверяющий.</p>}
    </Link>)}</div>}
    {!reportId&&<div className="mt-4 flex gap-4"><button disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>Назад</button><button disabled={busy||!more} onClick={()=>setPage(p=>p+1)}>Далее</button></div>}
  </DashboardLayout>;
}
