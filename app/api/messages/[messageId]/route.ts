import { NextRequest, NextResponse } from 'next/server';
import { requestDatabase,hasRole } from '@/lib/server/authorization';
import { z } from 'zod';
const update=z.object({body:z.string().trim().min(1).max(12000)}).strict();
async function access(request:NextRequest,id:string){
 const db=requestDatabase(request);
 if(!await hasRole(db,'developer'))return null;
 const {data}=await db.from('organization_messages').select('report_id').eq('id',id).maybeSingle();
 return data?db:null;
}
export async function PATCH(request:NextRequest,{params}:{params:{messageId:string}}){
 const db=await access(request,params.messageId);if(!db)return NextResponse.json({error:'Нет доступа'},{status:403});
 const body=update.safeParse(await request.json().catch(()=>null));
 if(!body.success)return NextResponse.json({error:'Можно изменять только текст черновика; доставка подтверждается провайдером.'},{status:400});
 const patch={body:body.data.body};
 const {data,error}=await db.from('organization_messages').update(patch).eq('id',params.messageId).eq('status','draft').select('id').maybeSingle();
 return error||!data?NextResponse.json({error:'Не удалось обновить сообщение'},{status:409}):NextResponse.json({success:true});
}
export async function DELETE(request:NextRequest,{params}:{params:{messageId:string}}){
 const db=await access(request,params.messageId);if(!db)return NextResponse.json({error:'Нет доступа'},{status:403});
 const {data,error}=await db.from('organization_messages').delete().eq('id',params.messageId).eq('status','draft').select('id').maybeSingle();
 return error||!data?NextResponse.json({error:'Можно удалить только доступный черновик'},{status:409}):NextResponse.json({success:true});
}
