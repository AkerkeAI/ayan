'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase-client';
import { User, Session } from '@supabase/supabase-js';

export type StaffRole = 'operator' | 'developer';
interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: StaffRole | null;
  isOperator: boolean;
  isDeveloper: boolean;
  isLoading: boolean;
  organizationId: string | null;
  organizationName: string | null;
  login: (email: string, password: string) => Promise<StaffRole | null>;
  logout: () => Promise<void>;
  refreshOperatorStatus: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
async function readProfile(userId: string): Promise<{role:StaffRole|null;organizationId:string|null;organizationName:string|null}> {
  const empty={role:null,organizationId:null,organizationName:null};
  const {data,error}=await supabase.from('operator_profiles').select('is_operator,role,organization_id').eq('id',userId).maybeSingle();
  if(error || !data?.is_operator || !['operator','developer'].includes(data.role))return empty;
  if(data.role==='developer')return {...empty,role:'developer'};
  const {data:organization}=data.organization_id?await supabase.from('organizations').select('id,name').eq('id',data.organization_id).maybeSingle():{data:null};
  return {role:'operator',organizationId:organization?.id??null,organizationName:organization?.name??null};
}
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [organizationId,setOrganizationId]=useState<string|null>(null);
  const [organizationName,setOrganizationName]=useState<string|null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const generation = useRef(0);
  const refresh = async (next: Session | null) => {
    const version = ++generation.current;
    setSession(next); setRole(null); setOrganizationId(null); setOrganizationName(null); setIsLoading(true);
    const profile = next?.user ? await readProfile(next.user.id) : {role:null,organizationId:null,organizationName:null};
    if (version === generation.current) { setRole(profile.role); setOrganizationId(profile.organizationId); setOrganizationName(profile.organizationName); setIsLoading(false); }
  };
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({data}) => { if (active) void refresh(data.session); });
    // Do not await other Supabase calls inside the auth callback (auth lock).
    const {data: {subscription}} = supabase.auth.onAuthStateChange((_event, next) => {
      setTimeout(() => { if (active) void refresh(next); }, 0);
    });
    return () => { active = false; generation.current++; subscription.unsubscribe(); };
  }, []);
  const login = async (email: string, password: string) => {
    const {data,error} = await supabase.auth.signInWithPassword({email,password});
    if (error) throw error;
    const profile = await readProfile(data.user.id);
    await refresh(data.session);
    return profile.role;
  };
  const logout = async () => {
    const {error} = await supabase.auth.signOut(); if (error) throw error;
    await refresh(null);
  };
  return <AuthContext.Provider value={{
    user:session?.user ?? null,session,role,isOperator:role==='operator',isDeveloper:role==='developer',
    isLoading,organizationId,organizationName,login,logout,refreshOperatorStatus:()=>refresh(session),
  }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
