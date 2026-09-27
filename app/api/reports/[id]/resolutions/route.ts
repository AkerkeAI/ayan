import { NextRequest, NextResponse } from 'next/server';
import { requestDatabase, hasRole, advisoryDatabase, canOperateReport } from '@/lib/server/authorization';
import { z } from 'zod';
import { compareEvidence } from '@/lib/resolutions/ai';
import { fetchEvidence } from '@/lib/resolutions/images';

export const dynamic = 'force-dynamic';
const uuid = z.string().uuid();
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit'), note: z.string().trim().min(5).max(2000), photoPath: z.string().max(300) }),
  z.object({ action: z.literal('analyze'), resolutionId: uuid }),
  z.object({ action: z.literal('verify'), resolutionId: uuid }),
  z.object({ action: z.literal('reopen'), resolutionId: uuid }),
  z.object({ action: z.literal('feedback'), resolutionId: uuid, token: uuid, decision: z.enum(['confirm', 'reopen']) }),
]);
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!uuid.safeParse(params.id).success) return NextResponse.json({ error: 'Некорректный ID' }, {status:400});
  // Bound JSON before parsing; never accept uploaded file bytes on this endpoint.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({error:'Нет данных'}, {status:400});
  let raw = ''; let size = 0; const decoder = new TextDecoder();
  while (true) {
    const {value,done} = await reader.read(); if (done) break;
    size += value.length;
    if (size > 12000) { await reader.cancel(); return NextResponse.json({error:'Слишком большой запрос'}, {status:413}); }
    raw += decoder.decode(value,{stream:true});
  }
  let body;
  try { body = command.parse(JSON.parse(raw + decoder.decode())); }
  catch { return NextResponse.json({error:'Проверьте введённые данные'}, {status:400}); }
  const db = requestDatabase(request);
  try {
    if (body.action !== 'feedback') {
      const role = body.action === 'verify' || body.action === 'reopen' ? 'developer' : 'operator';
      if (!await hasRole(db,role)) return NextResponse.json({error:role === 'developer' ? 'Требуется оператор Aýan' : 'Требуется вход исполнителя'}, {status:403});
    }
    if ((body.action === 'submit' || body.action === 'analyze') && !await canOperateReport(db,params.id)) {
      return NextResponse.json({error:'Обращение не назначено вашей организации'}, {status:403});
    }
    if (body.action === 'submit') {
      const {data: {user}} = await db.auth.getUser(request.headers.get('authorization')?.replace(/^Bearer /i,''));
      if (!user || !body.photoPath.startsWith(`${user.id}/${params.id}/`) || !/^[a-f0-9/-]+\.(jpg|png|webp)$/.test(body.photoPath)) {
        return NextResponse.json({error:'Некорректное фото'}, {status:400});
      }
      const url = db.storage.from('resolution-images').getPublicUrl(body.photoPath).data.publicUrl;
      await fetchEvidence(url); // Real bytes and MIME validated before saving the resolution.
      const {data, error} = await db.rpc('submit_report_resolution', {p_report_id:params.id,p_note:body.note,p_photo_path:body.photoPath});
      if (error) throw error;
      return NextResponse.json({resolutionId:data});
    }
    const {data: resolution, error: readError} = await db.from('report_resolutions').select('id,state,after_photo_path,submitted_by').eq('id',body.resolutionId).eq('report_id',params.id).maybeSingle();
    if (readError) throw readError;
    if (!resolution) return NextResponse.json({error:'Проверка не найдена'}, {status:404});
    if (body.action === 'feedback' && resolution.state === 'verified') {
      return NextResponse.json({error:'Решение подтверждено оператором Aýan. Отзывы жителей для этой проверки закрыты.'}, {status:403});
    }
    let result;
    if (body.action === 'analyze') {
      if (resolution.state !== 'pending') return NextResponse.json({success:true});
      const writer = advisoryDatabase();
      if (!writer) return NextResponse.json({success:true,manualReview:true});
      const {data: report} = await db.from('reports').select('photo_url').eq('id',params.id).single();
      const after = db.storage.from('resolution-images').getPublicUrl(resolution.after_photo_path).data.publicUrl;
      const advisory = await compareEvidence(report?.photo_url || null, after);
      result = await writer.rpc('record_resolution_ai', {p_resolution_id:resolution.id,p_result:advisory});
    } else if (body.action === 'verify' || body.action === 'reopen') {
      const {data:{user}} = await db.auth.getUser(request.headers.get('authorization')?.replace(/^Bearer /i,''));
      if (!user || !resolution.submitted_by || resolution.submitted_by === user.id) return NextResponse.json({error:'Нельзя проверять собственные доказательства или доказательства с неизвестным автором'}, {status:403});
      result = await db.rpc('review_report_resolution', {p_resolution_id:resolution.id,p_decision:body.action});
    } else {
      result = await db.rpc('resolution_resident_feedback', {p_resolution_id:resolution.id,p_token:body.token,p_decision:body.decision});
    }
    if (result.error) throw result.error;
    return NextResponse.json({success:true});
  } catch (error) {
    if ((error as {code?:string}).code === '42501') return NextResponse.json({error:'Недостаточно прав для этого действия'}, {status:403});
    console.error('[RESOLUTION_ERROR]', error instanceof Error ? error.message : (error as {code?:string}).code);
    return NextResponse.json({error:'Не удалось выполнить действие. Обновите страницу: проверка могла измениться или отзыв уже учтён. Убедитесь, что миграция 00008 применена.'}, {status:409});
  }
}
