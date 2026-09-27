import { NextRequest,NextResponse } from 'next/server';
import { requestDatabase,hasRole } from '@/lib/server/authorization';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 const db=requestDatabase(request);
 if(!await hasRole(db,'developer'))return NextResponse.json({error:'Нет доступа'},{status:403});
 const requested=new URL(request.url).searchParams.get('id');
 let query=db.from('organizations').select('*');
 if(requested)query=query.eq('id',requested);
 else query=query.eq('active',true).order('name');
 const {data,error}=await query;
 if(error)return NextResponse.json({error:'Организация недоступна'},{status:409});
 return NextResponse.json(requested?{organization:data?.[0]??null}:{organizations:data});
}
