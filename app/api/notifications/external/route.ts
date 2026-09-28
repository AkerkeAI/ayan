import {NextRequest,NextResponse} from 'next/server';
import {requestDatabase,hasRole} from '@/lib/server/authorization';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 const db=requestDatabase(request);if(!await hasRole(db,'developer'))return NextResponse.json({error:'Нет доступа'},{status:403});
 const page=Number(request.nextUrl.searchParams.get('page')||'0');if(!Number.isSafeInteger(page)||page<0||page>10000)return NextResponse.json({error:'Некорректная страница'},{status:400});
 const {data,error}=await db.from('external_notifications').select('id,report_id,event_type,channel,status,attempts,last_code,created_at,sent_at').order('created_at',{ascending:false}).order('id').range(page*30,page*30+30);
 return error?NextResponse.json({error:'Очередь недоступна. Проверьте миграцию Phase 5F.'},{status:503}):NextResponse.json({items:(data||[]).slice(0,30),more:(data?.length||0)>30,configured:{provider:!!process.env.RESEND_API_KEY&&!!process.env.RESEND_FROM_EMAIL,worker:(process.env.CRON_SECRET?.length||0)>=32&&!!process.env.SUPABASE_SERVICE_ROLE_KEY,site:!!process.env.AYAN_SITE_URL}},{headers:{'Cache-Control':'private, no-store'}});
}
export async function POST(request:NextRequest){
 const db=requestDatabase(request);if(!await hasRole(db,'developer'))return NextResponse.json({error:'Нет доступа'},{status:403});
 const parsed=z.object({id:z.string().uuid()}).strict().safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Некорректные данные'},{status:400});
 const {error}=await db.rpc('retry_external_notification',{p_id:parsed.data.id});
 return error?NextResponse.json({error:'Повтор небезопасен или канал ещё не настроен. Проверьте доставку у провайдера.'},{status:409}):NextResponse.json({success:true});
}
