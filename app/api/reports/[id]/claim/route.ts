import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestDatabase, hasRole } from '@/lib/server/authorization';
async function handle(request: NextRequest, id: string, claim: boolean) {
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({error:'Некорректный ID'},{status:400});
  const db=requestDatabase(request);
  if (!await hasRole(db,'operator')) return NextResponse.json({error:'Доступ только для исполнителя'},{status:403});
  // Never accept an organization from the request. DB derives it from authenticated membership.
  const {data,error}=await db.rpc(claim?'claim_report':'report_claim_access',{p_report_id:id});
  if(error)return NextResponse.json({error:error.code==='40001'?'Задачу уже взяла другая организация':'Задача недоступна для взятия в работу'},{status:error.code==='42501'?403:409});
  return NextResponse.json(claim?{success:true}:data,{headers:{'Cache-Control':'private, no-store'}});
}
export function GET(request:NextRequest,{params}:{params:{id:string}}){return handle(request,params.id,false);}
export function POST(request:NextRequest,{params}:{params:{id:string}}){return handle(request,params.id,true);}
