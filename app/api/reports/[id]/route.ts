import { NextRequest,NextResponse } from 'next/server';
import { requestDatabase } from '@/lib/server/authorization';
import { z } from 'zod';
export async function POST(request:NextRequest,{params}:{params:{id:string}}){
 if(!z.string().uuid().safeParse(params.id).success)return NextResponse.json({error:'Некорректный ID'},{status:400});
 const {data,error}=await requestDatabase(request).rpc('assign_report_organization',{p_report_id:params.id});
 if(error)return NextResponse.json({error:'Не удалось назначить организацию'},{status:error.code==='P0002'?404:409});
 return NextResponse.json({success:true,reportId:params.id,organizationId:data,requiresManualRouting:data===null});
}
