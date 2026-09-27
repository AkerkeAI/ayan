import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestDatabase, hasRole } from '@/lib/server/authorization';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const db = requestDatabase(request);
  if (!await hasRole(db,'developer')) return NextResponse.json({error:'Доступ только для оператора Aýan'}, {status:403});
  const reportId = request.nextUrl.searchParams.get('reportId');
  if (reportId && !z.string().uuid().safeParse(reportId).success) return NextResponse.json({error:'Некорректный ID'}, {status:400});
  const page = Number(request.nextUrl.searchParams.get('page') || '0');
  if (!Number.isSafeInteger(page) || page<0 || page>10000) return NextResponse.json({error:'Некорректная страница'}, {status:400});
  let query = db.from('report_resolutions').select('*,reports(*)', {count:'exact'});
  if (reportId) query=query.eq('report_id',reportId);
  else query=query.or('state.in.(pending,ai_checked,needs_review,resident_confirmed),and(state.eq.verified,reviewed_at.is.null)');
  const {data,error,count} = await query.order('submitted_at',{ascending:false}).range(page*30,page*30+29);
  if (error) return NextResponse.json({error:'Не удалось загрузить очередь проверки'}, {status:503});
  let reviews: unknown[] = [];
  if (reportId && data?.length) {
    const audit = await db.from('resolution_reviews').select('resolution_id,reviewer_user_id,reviewed_at,decision,verification_state')
      .in('resolution_id',data.map(r=>r.id)).order('reviewed_at',{ascending:false});
    if (audit.error) return NextResponse.json({error:'Не удалось загрузить журнал проверки'}, {status:503});
    reviews=audit.data || [];
  }
  return NextResponse.json({cases:data || [],reviews,hasMore:(page+1)*30<(count || 0)}, {headers:{'Cache-Control':'private, no-store'}});
}
