import { supabase } from './supabase-client';

export type TimeFilter = 7 | 30 | 90 | null;
export interface CityIntelligenceKPIs {
  total_reports: number; active_reports: number; verified_resolved: number;
  reopened_reports: number; total_supports: number; detected_hotspots: number;
  avg_resolution_hours: number | null; median_resolution_hours: number | null;
}
export interface Hotspot {
  hotspot_id: string; category: string; center_lat: number; center_lng: number;
  report_count: number; total_support_count: number; active_count: number;
  verified_resolved_count: number; reopened_count: number;
  first_report_date: string; latest_report_date: string;
}
export interface TimeTrendData {
  date_label: string; date_value: string; report_count: number; active_count: number; resolved_count: number;
}
export interface HeatmapPoint { latitude: number; longitude: number; intensity: number }
export interface AnalyticsData {
  kpis: CityIntelligenceKPIs; hotspots: Hotspot[]; trend: TimeTrendData[]; points: HeatmapPoint[];
}

function numeric(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value))) {
    throw new Error('Invalid numeric analytics response');
  }
  return Number(value);
}
function numbers<T>(row: Record<string, unknown>, fields: string[]): T {
  const result = { ...row };
  for (const field of fields) result[field] = numeric(row[field]);
  return result as T;
}
async function rows(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    // Diagnostics only in development; no credentials, rows or raw database errors in the UI.
    if (process.env.NODE_ENV !== 'production') console.error('[ANALYTICS_RPC]', { rpc: name, code: error.code, message: error.message });
    throw new Error('Analytics request failed');
  }
  if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object')) throw new Error('Invalid analytics response');
  return data;
}
export async function fetchAnalytics(days: TimeFilter, category: string | null): Promise<AnalyticsData> {
  const args = { p_days_filter: days, p_category: category };
  const [summary, zones, timeline, heat] = await Promise.all([
    rows('get_city_intelligence_summary', args),
    rows('detect_hotspots', { ...args, p_radius_meters: 150, p_min_reports: 3 }),
    rows('get_time_trend_data', { ...args, p_status: null }),
    rows('get_heatmap_data', args),
  ]);
  if (summary.length !== 1) throw new Error('Missing analytics summary');
  const kpis = numbers<CityIntelligenceKPIs>(summary[0], ['total_reports','active_reports','verified_resolved','reopened_reports','total_supports','detected_hotspots']);
  for (const key of ['avg_resolution_hours','median_resolution_hours'] as const) {
    kpis[key] = summary[0][key] === null ? null : numeric(summary[0][key]);
  }
  const hotspots = zones.map(row => numbers<Hotspot>(row, ['center_lat','center_lng','report_count','total_support_count','active_count','verified_resolved_count','reopened_count']));
  const trend = timeline.map(row => numbers<TimeTrendData>(row, ['report_count','active_count','resolved_count']));
  const points = heat.map(row => numbers<HeatmapPoint>(row, ['latitude','longitude','intensity'])).filter(p =>
    Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && p.intensity > 0);
  return { kpis: { ...kpis, detected_hotspots: hotspots.length }, hotspots, trend, points };
}
export function formatResolutionTime(hours: number | null): string {
  if (hours === null) return 'Нет подтверждённых решений';
  if (hours < 1) return `${Math.round(hours * 60)} мин`;
  if (hours < 24) return `${hours.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч`;
  return `${(hours / 24).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} дн`;
}
