import { NextRequest,NextResponse } from 'next/server';
import { requestDatabase,hasRole } from '@/lib/server/authorization';
import { generateAndStoreMessage } from '@/lib/messaging/organization-messages';
import { rowToReport } from '@/lib/types';
import { z } from 'zod';
export async function POST(request:NextRequest){
 const body=z.object({reportId:z.string().uuid(),organizationId:z.string().uuid()}).strict().safeParse(await request.json().catch(()=>null));
 if(!body.success)return NextResponse.json({error:'Некорректные данные'},{status:400});
 const db=requestDatabase(request);
 if(!await hasRole(db,'developer'))return NextResponse.json({error:'Нет доступа'},{status:403});
 const {data:report}=await db.from('reports').select('*').eq('id',body.data.reportId).maybeSingle();
 if(!report || report.organization_id!==body.data.organizationId)return NextResponse.json({error:'Назначение изменилось'},{status:403});
 const {data:organization}=await db.from('organizations').select('*').eq('id',report.organization_id).maybeSingle();
 if(!organization)return NextResponse.json({error:'Нет доступа'},{status:403});
 const message=await generateAndStoreMessage(report.id,organization.id,rowToReport(report),organization,db);
 return message?NextResponse.json({success:true,message}):NextResponse.json({error:'Не удалось создать черновик'},{status:409});
}
