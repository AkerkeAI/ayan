import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

export function requestDatabase(request: NextRequest) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: {persistSession:false,autoRefreshToken:false},
    global: {headers: {Authorization:request.headers.get('authorization') || `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`}},
  });
}
export async function hasRole(db: ReturnType<typeof requestDatabase>, role: 'operator'|'developer') {
  const {data,error} = await db.rpc(role==='developer'?'is_developer':'is_operator');
  return !error && data === true;
}
// Server-only trusted AI writer. Never import this module into a client component.
// Without a server credential, evidence remains pending for independent manual review.
export function advisoryDatabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,key,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
}

export async function canOperateReport(db: ReturnType<typeof requestDatabase>, reportId: string) {
  const {data,error}=await db.rpc('can_operate_report',{p_report_id:reportId});
  return !error && data===true;
}
