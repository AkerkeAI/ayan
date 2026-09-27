import { supabase } from './supabase-client';
import type { TimeFilter } from './analytics';

export interface IntelligenceConfig {
  spatial_radius_meters: number; min_distinct_reports: number;
  recurrence_span_days: number; unresolved_days: number; min_resolution_samples: number;
}
export interface SystemicIssue {
  hotspot_id: string; category: string; center_lat: number; center_lng: number;
  report_count: number; support_count: number; active_count: number; verified_count: number; reopened_count: number;
  first_observed: string; latest_observed: string; span_days: number; longest_open_days: number | null;
  long_unresolved_count: number; post_resolution_count: number;
  organization_id: string | null; organization_name: string | null;
  signals: { spatial_recurrence: boolean; time_span: boolean; reopened: boolean; post_resolution_recurrence: boolean; long_unresolved: boolean };
}
export interface ServicePerformance {
  organization_id: string; organization_name: string; assigned_count: number; active_count: number;
  verified_count: number; reopened_count: number; verification_decisions: number; reopen_decisions: number;
  resolution_samples: number; avg_resolution_hours: number | null; median_resolution_hours: number | null; verified_share: number;
}
export interface SystemicData { config: IntelligenceConfig; issues: SystemicIssue[] }
export interface ServiceData { config: IntelligenceConfig; organizations: ServicePerformance[]; unassigned_count: number; total_reports: number }
export type ReportScope = { hotspot_id: string; organization_id?: never } | { organization_id: string; hotspot_id?: never };
export interface IntelligenceReport { id: string; category: string; status: string; created_at: string }
export interface ReportPage { total: number; reports: IntelligenceReport[] }

async function request(name: string, args: Record<string,unknown>) {
  const { data,error } = await supabase.rpc(name,args);
  if (error) {
    if (process.env.NODE_ENV!=='production') console.error('[INTELLIGENCE_RPC]',{rpc:name,code:error.code,message:error.message});
    throw new Error('Intelligence unavailable');
  }
  if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error('Invalid intelligence response');
  return data;
}
function finite(row: Record<string,unknown>, keys: string[]) {
  for (const key of keys) if (typeof row[key]!=='number' || !Number.isFinite(row[key])) throw new Error('Invalid intelligence number');
}
function config(value: IntelligenceConfig) {
  if (!value) throw new Error('Missing intelligence configuration');
  finite(value as unknown as Record<string,unknown>,['spatial_radius_meters','min_distinct_reports','recurrence_span_days','unresolved_days','min_resolution_samples']);
}
export async function fetchSystemicIssues(days: TimeFilter, category: string | null): Promise<SystemicData> {
  const data = await request('get_systemic_issues',{p_days_filter:days,p_category:category});
  config(data.config);
  if (!Array.isArray(data.issues)) throw new Error('Missing systemic issues');
  for (const issue of data.issues) {
    finite(issue,['center_lat','center_lng','report_count','support_count','active_count','verified_count','reopened_count','span_days','long_unresolved_count','post_resolution_count']);
    if (!issue.signals || Object.values(issue.signals).some(v=>typeof v!=='boolean')) throw new Error('Invalid systemic signals');
  }
  return data;
}
export async function fetchServicePerformance(days: TimeFilter, category: string | null): Promise<ServiceData> {
  const data=await request('get_service_performance',{p_days_filter:days,p_category:category});
  config(data.config); finite(data,['unassigned_count','total_reports']);
  if (!Array.isArray(data.organizations)) throw new Error('Missing organizations');
  for (const row of data.organizations) {
    finite(row,['assigned_count','active_count','verified_count','reopened_count','verification_decisions','reopen_decisions','resolution_samples','verified_share']);
    for (const key of ['avg_resolution_hours','median_resolution_hours']) if(row[key]!==null)finite(row,[key]);
  }
  return data;
}
export async function fetchIntelligenceReports(days: TimeFilter, category: string | null, scope: ReportScope, offset: number): Promise<ReportPage> {
  const data=await request('get_intelligence_reports',{p_days_filter:days,p_category:category,p_hotspot_id:scope.hotspot_id??null,p_organization_id:scope.organization_id??null,p_offset:offset});
  finite(data,['total']);
  if (!Array.isArray(data.reports)) throw new Error('Missing report page');
  return data;
}
export function systemicReasons(issue: SystemicIssue, thresholds: IntelligenceConfig): string[] {
  const reasons=[`${issue.report_count} обращений появились рядом друг с другом`];
  if(issue.signals.time_span) reasons.push(`Обращения повторяются уже ${Math.floor(issue.span_days)} дн`);
  if(issue.signals.reopened) reasons.push(`Пришлось повторно открыть обращений: ${issue.reopened_count}`);
  if(issue.signals.post_resolution_recurrence) reasons.push(`После подтверждённого решения рядом появились новые обращения: ${issue.post_resolution_count}`);
  if(issue.signals.long_unresolved) reasons.push(`Ожидают решения не менее ${thresholds.unresolved_days} дней: ${issue.long_unresolved_count}`);
  return reasons;
}
