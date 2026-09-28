import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestDatabase, hasRole } from '@/lib/server/authorization';

export async function GET(request: NextRequest) {
  const db = requestDatabase(request);
  if (!await hasRole(db, 'developer')) return NextResponse.json({ error: 'Доступ только для оператора Aýan' }, { status: 403 });
  const parsed = z.coerce.number().int().min(0).max(10000).safeParse(request.nextUrl.searchParams.get('page') ?? 0);
  if (!parsed.success) return NextResponse.json({ error: 'Некорректная страница' }, { status: 400 });
  const offset = parsed.data * 20;
  const [suggestions, categories] = await Promise.all([
    db.from('category_discoveries').select('report_id,description,photo_url,result,created_at').eq('state', 'pending').order('created_at').order('report_id').range(offset, offset + 20),
    db.from('category_catalog').select('key,name,active').neq('key', 'other').order('name'),
  ]);
  if (suggestions.error || categories.error) return NextResponse.json({ error: 'Не удалось загрузить предложения категорий' }, { status: 503 });
  return NextResponse.json({ suggestions: suggestions.data.slice(0, 20), hasMore: suggestions.data.length > 20, categories: categories.data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
const decisionSchema = z.object({ reportId: z.string().uuid(), decision: z.enum(['accept', 'reject']), name: z.string().trim().min(3).max(60).optional(), existingKey: z.string().min(1).max(80).optional() }).strict();
export async function POST(request: NextRequest) {
  const db = requestDatabase(request);
  if (!await hasRole(db, 'developer')) return NextResponse.json({ error: 'Доступ только для оператора Aýan' }, { status: 403 });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Проверьте название и решение' }, { status: 400 });
  const { reportId, decision, name, existingKey } = parsed.data;
  const { error } = await db.rpc('review_category_suggestion', { p_report_id: reportId, p_decision: decision, p_name: name ?? null, p_existing_key: existingKey ?? null });
  if (error) return NextResponse.json({ error: 'Решение не сохранено. Обновите очередь и проверьте название категории.' }, { status: error.code === '42501' ? 403 : 409 });
  return NextResponse.json({ success: true });
}
