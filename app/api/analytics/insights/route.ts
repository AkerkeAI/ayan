import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestDatabase, hasRole } from '@/lib/server/authorization';
import { factSentences, narrateFacts } from '@/lib/analytics-insights/narrative';
export const maxDuration=60;
export const runtime='nodejs';
const input=z.object({days:z.union([z.literal(7),z.literal(30),z.literal(90),z.null()]),category:z.enum(['roads','lighting','garbage','water','manholes','sidewalks','infrastructure','other']).nullable()}).strict();
export async function POST(request:NextRequest){
 const db=requestDatabase(request);
 if(!await hasRole(db,'operator')&&!await hasRole(db,'developer'))return NextResponse.json({error:'Staff required'},{status:403});
 const parsed=input.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid filters'},{status:400});
 try{
  const args={p_days_filter:parsed.data.days,p_category:parsed.data.category};
  const [hotspots,systemic,services]=await Promise.all([db.rpc('detect_hotspots',{...args,p_radius_meters:150,p_min_reports:3}),db.rpc('get_systemic_issues',args),db.rpc('get_service_performance',args)]);
  if(hotspots.error||systemic.error||services.error||!Array.isArray(hotspots.data)||!Array.isArray(systemic.data?.issues))throw Error('Facts unavailable');
  const text=await narrateFacts(factSentences(hotspots.data.length,systemic.data.issues.length,services.data?.unassigned_count));
  return NextResponse.json({text},{headers:{'Cache-Control':'private, no-store'}});
 }catch{console.warn('[analytics_insights]',{code:'FACTS_UNAVAILABLE'});return NextResponse.json({text:null},{headers:{'Cache-Control':'private, no-store'}});}
}
