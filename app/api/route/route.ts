import { NextRequest,NextResponse } from 'next/server';
import { POST as route } from '@/app/api/reports/[id]/route';
export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>null);
 if(!body?.reportId)return NextResponse.json({error:'Report ID required'},{status:400});
 return route(request,{params:{id:body.reportId}});
}
