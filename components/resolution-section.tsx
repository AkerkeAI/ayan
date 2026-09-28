'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { Report } from '@/lib/types';
import { getSupporterToken } from '@/lib/supporter-token';
import { useAuth } from '@/lib/auth-context';
import { Resolution, resolutionLabel, resolutionReviewMessage } from '@/lib/resolutions/types';
import { toast } from 'sonner';

import {EvidenceCapture} from '@/components/evidence-capture';
import {EvidenceTrust,RejectEvidence} from '@/components/evidence-trust';
import {currentEvidenceSignals,stripPhotoMetadata,CaptureInfo} from '@/lib/resolutions/capture';

const button = 'rounded-lg border px-4 py-2 text-sm disabled:opacity-50';
export function ResolutionSection({report,isOperator,onChanged,onLatestChange}:{report:Report;isOperator:boolean;onChanged:()=>Promise<void>;onLatestChange?:(value:Resolution|null)=>void}) {
  const { user, isDeveloper, isOperator: executor, isLoading: authLoading } = useAuth();
  const capture=useRef<CaptureInfo>({source:'unknown'});
  const [rows,setRows] = useState<Resolution[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [note,setNote] = useState('');
  const [file,setFile] = useState<File|null>(null);
  const [busy,setBusy] = useState(false);
  const [reviewed,setReviewed] = useState(false);
  const [voted,setVoted] = useState<string[]>([]);
  async function load() {
    const query=isDeveloper ? supabase.rpc('developer_resolution_rows') : supabase.from('report_resolutions').select('id,report_id,note,after_photo_path,submitted_at,state,submitted_by,reviewed_at');
    const {data,error} = await query.eq('report_id',report.id).order('submitted_at',{ascending:false});
    if (error) { setError('Проверка решения пока недоступна. Обратитесь к администратору.'); setLoading(false); return; }
    setRows((data || []).map((r:Resolution)=>({...r,ai_result:r.ai_result??null})));onLatestChange?.(data?.[0] || null);setError('');setLoading(false);
    try { setVoted((data || []).filter((r:Resolution)=>localStorage.getItem(`resolution-vote:${r.id}`)).map((r:Resolution)=>r.id)); } catch { /* DB still enforces one vote per token. */ }
  }
  useEffect(()=>{void load();setReviewed(false);},[report.id,isDeveloper,executor]); // eslint-disable-line react-hooks/exhaustive-deps
  async function request(body:Record<string,unknown>) {
    const {data:{session}} = await supabase.auth.getSession();
    const response = await fetch(`/api/reports/${report.id}/resolutions`,{
      method:'POST',headers:{'Content-Type':'application/json',...(session ? {Authorization:`Bearer ${session.access_token}`} : {})},body:JSON.stringify(body),
    });
    const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Ошибка проверки'); return data;
  }
  async function act(body:Record<string,unknown>) {
    setBusy(true);
    try {
      await request(body);
      if(body.action==='feedback') {
        setVoted(v=>[...v,String(body.resolutionId)]);
        try {localStorage.setItem(`resolution-vote:${body.resolutionId}`,'1');} catch {}
      }
      await load(); await onChanged();setReviewed(false);toast.success('Изменение сохранено');
    } catch(e) {toast.error(e instanceof Error?e.message:'Ошибка');} finally {setBusy(false);}
  }
  async function feedback(resolutionId: string, decision: 'confirm' | 'reopen') {
    try { await act({action:'feedback',resolutionId,token:getSupporterToken(),decision}); }
    catch { toast.error('Разрешите локальное хранилище браузера, чтобы отправить отзыв.'); }
  }
  async function submit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!file) {toast.error('Добавьте фото после работ');return;}
    const form=e.currentTarget;
    if(file.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type)) {toast.error('Выберите JPEG, PNG или WebP до 5 МБ');return;}
    setBusy(true);
    try {
      const {data:{user}} = await supabase.auth.getUser();if(!user) throw new Error('Войдите как исполнитель');
      const prepared=await stripPhotoMetadata(file);
      const signals=await currentEvidenceSignals(capture.current);
      const ext=prepared.type==='image/jpeg'?'jpg':prepared.type==='image/png'?'png':'webp';
      const path=`${user.id}/${report.id}/${crypto.randomUUID()}.${ext}`;
      const {error}=await supabase.storage.from('resolution-images').upload(path,prepared,{contentType:prepared.type,upsert:false});if(error) throw error;
      const result=await request({action:'submit',note,photoPath:path,signals});
      setNote('');setFile(null);form.reset();await load();await onChanged();
      toast.success('Решение отправлено на проверку оператору Aýan.');
      // Submission is committed before optional AI analysis. Failure cannot undo evidence.
      try {const analysis = await request({action:'analyze',resolutionId:result.resolutionId});await load();await onChanged();}
      catch { /* Saved evidence remains in the review queue; diagnostics are reviewer-only. */ }
    } catch(e) {toast.error(e instanceof Error?e.message:'Не удалось сохранить решение');} finally {setBusy(false);}
  }
  const current=rows[0];
  return <section className="space-y-4 rounded-xl border bg-white p-5" aria-busy={busy}>
    <h3 className="font-semibold text-navy">Проверка решения</h3>
    <p className="text-sm text-muted-foreground">Предоставленные доказательства и анализ ИИ не означают подтверждённое решение. Окончательное решение принимает оператор Aýan.</p>
    {loading && <p>Загрузка…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && !current && <p className="text-sm">Доказательства решения ещё не предоставлены.{report.status==='resolved' && ' Прежний статус «Решено» не является подтверждением по новой процедуре.'}</p>}
    {rows.map((r,i)=><article key={r.id} className="space-y-3 rounded-lg border p-3">
      <p className="font-medium">{executor && !['verified','reopened'].includes(r.state)?'Решение отправлено на проверку оператору Aýan.':resolutionLabel(r)}{i>0?' · Предыдущая попытка':''}</p>
      <p className="text-xs text-muted-foreground">Предоставлено: {new Date(r.submitted_at).toLocaleString('ru-RU')}{r.reviewed_at && ` · Проверено: ${new Date(r.reviewed_at).toLocaleString('ru-RU')}`}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <figure><figcaption>До</figcaption>{report.photoUrl ? <img src={report.photoUrl} alt="Исходное фото проблемы" className="h-56 w-full rounded object-contain"/>:<p className="p-4 text-sm">Исходное фото отсутствует</p>}</figure>
        <figure><figcaption>После</figcaption><img src={supabase.storage.from('resolution-images').getPublicUrl(r.after_photo_path).data.publicUrl} alt="Фото выполненных работ" className="h-56 w-full rounded object-contain"/></figure>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{r.note}</p>
      {isDeveloper && <p className="text-sm text-muted-foreground">{resolutionReviewMessage(r.ai_result)}</p>}
      {isDeveloper && r.ai_result && <div className="rounded bg-muted p-3 text-sm"><p className="font-medium">ИИ: вспомогательный анализ, не подтверждение</p><p>{r.ai_result.likely_resolved?'На фото возможны признаки устранения':'Изменение не удалось подтвердить по фото'} · Уверенность модели: {Math.round(r.ai_result.confidence*100)}%</p><p>Дополнительная проверка по результату ИИ: {r.ai_result.requires_human_review ? 'требуется' : 'не запрошена'}. Решение всегда принимает независимый проверяющий.</p><ul className="list-disc pl-5">{r.ai_result.observations.map((o,j)=><li key={j}>{o}</li>)}</ul></div>}
      {isDeveloper && <EvidenceTrust key={`${r.id}:${r.state}:${r.ai_result ? 'ai' : 'pending'}`} id={r.id}/>}
      {i===0 && r.state!=='reopened' && <div className="space-y-3">
        {isOperator && (r.state!=='verified' || !r.reviewed_at) && <p className="rounded bg-amber-50 p-3 text-sm">Решение отправлено на проверку оператору Aýan.</p>}
        {isDeveloper && <>
          {!r.submitted_by || r.submitted_by===user?.id
            ? <p className="text-sm">{!r.submitted_by ? 'Автор доказательств не установлен. Обратитесь к администратору для проверки происхождения.' : 'Это ваши доказательства. Требуется другой независимый проверяющий.'}</p>
            : <><label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>Я независимо проверил(а) фото, описание и результат ИИ</label>
              <div className="flex flex-wrap gap-2">
                {(r.state!=='verified' || !r.reviewed_at) && <button className={button} disabled={busy||!reviewed} onClick={()=>act({action:'verify',resolutionId:r.id})}>Подтвердить решение</button>}
                {r.state!=='verified' && <RejectEvidence disabled={busy||!reviewed} onReject={reason=>void act({action:'reopen',resolutionId:r.id,reason})}/>}
              </div></>}
        </>}
        {!isOperator && !isDeveloper && !authLoading && r.state!=='verified' && <><p className="text-xs text-muted-foreground">Отзыв из этого браузера анонимный и не подтверждает личность. Один отзыв на попытку решения; положительный отзыв требует проверки оператором Aýan.</p>{voted.includes(r.id)?<p className="text-sm">Ваш отзыв уже учтён</p>:<div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>feedback(r.id,'confirm')}>Проблема устранена</button><button className={button} disabled={busy} onClick={()=>feedback(r.id,'reopen')}>Проблема остаётся — открыть повторно</button></div>}</>}
      </div>}
    </article>)}
    {isOperator && !loading && !error && report.status!=='resolved' && (!current||current.state==='reopened') && <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">Что было сделано<textarea required minLength={5} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} className="mt-1 min-h-[90px] w-full rounded border p-2"/></label>
      <EvidenceCapture disabled={busy} onChange={(photo,info)=>{setFile(photo);capture.current=info;}}/>
      <p className="text-xs text-muted-foreground">Описание и фото будут видны публично. Не добавляйте личные данные.</p>
      <button disabled={busy} className={button+' bg-navy text-white'}>{busy?'Сохранение и проверка…':'Предоставить решение для проверки'}</button>
    </form>}
  </section>;
}
