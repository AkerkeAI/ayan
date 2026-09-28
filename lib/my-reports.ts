import { supabase } from './supabase-client';
import { ownedReportIds } from './anonymous-history';
import { rowToReport, type Report, type ReportRow } from './types';

export async function fetchMyReports(): Promise<Report[]> {
  const ids = ownedReportIds();
  if (!ids.length) return []; // Never fall back to the public all-reports query.
  const reports: Report[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase.from('reports').select('*').in('id', ids.slice(offset, offset + 100));
    if (error) throw error;
    reports.push(...(data as ReportRow[]).map(rowToReport));
  }
  const withSupport = await Promise.all(reports.map(async report => {
    try {
      const { data, error } = await supabase.rpc('get_report_support_count', { p_report_id: report.id });
      return !error && data !== null ? { ...report, supportCount: data } : report;
    } catch { return report; }
  }));
  return withSupport.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
