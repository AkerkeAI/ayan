import { NextRequest, NextResponse } from 'next/server';
import { requestDatabase,hasRole } from '@/lib/server/authorization';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest,{params}:{params:{reportId:string}}) {
 const db=requestDatabase(request);
 if(!await hasRole(db,'developer'))return NextResponse.json({error:'Нет доступа'},{status:403});
 const latest=new URL(request.url).searchParams.get('latest')==='true';
 let query=db.from('organization_messages').select('*').eq('report_id',params.reportId).order('created_at',{ascending:!latest});
 if(latest)query=query.eq('status','draft').eq('direction','outbound').limit(1);
 const {data,error}=await query;
 if(error)return NextResponse.json({error:'Не удалось загрузить сообщения'},{status:500});
 return NextResponse.json(latest?{message:data?.[0]??null}:{messages:data});
}
