import { supabase } from './supabase-client';
import { rememberCreatedReport } from './anonymous-history';
import {
  Report,
  ReportStatus,
  ReportRow,
  ReportStats,
  rowToReport,
} from './types';
import { getReportEvents, convertEventsToHistory } from './events/report-events';

export async function fetchReports(): Promise<Report[]> {
  console.log('[MAP_FETCH_START]');
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[MAP_FETCH_ERROR]', error);
    throw error;
  }
  
  console.log('[MAP_FETCH_SUCCESS] databaseReports=', data?.length || 0);
  
  const reports = (data as ReportRow[]).map(rowToReport);
  
  // Fetch support counts for all reports using SECURITY DEFINER RPC
  const reportsWithSupportCount = await Promise.all(
    reports.map(async (report) => {
      try {
        const { data: count, error: countError } = await supabase.rpc('get_report_support_count', {
          p_report_id: report.id,
        });
        if (!countError && count !== null) {
          return { ...report, supportCount: count };
        }
        return report;
      } catch (error) {
        console.error('Error fetching support count for report:', report.id, error);
        return report;
      }
    })
  );
  
  const validCoordinates = reportsWithSupportCount.filter(r => r.lat && r.lng);
  console.log('[MAP_VALID_COORDINATES]', validCoordinates.length);
  
  return reportsWithSupportCount;
}

export async function fetchReportById(id: string): Promise<Report | null> {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  
  const report = rowToReport(data as ReportRow);
  
  // Fetch support count
  try {
    const { data: count, error: countError } = await supabase.rpc('get_report_support_count', {
      p_report_id: id,
    });
    if (!countError && count !== null) {
      return { ...report, supportCount: count };
    }
  } catch (error) {
    console.error('Error fetching support count for report:', id, error);
  }
  
  return report;
}

export async function fetchReportStats(): Promise<ReportStats> {
  const { data, error } = await supabase
    .from('reports')
    .select('status');

  if (error) throw error;

  const rows = data as { status: ReportStatus }[];
  return {
    total: rows.length,
    new: rows.filter((r) => r.status === 'new').length,
    inProgress: rows.filter((r) => r.status === 'in_progress').length,
    resolved: rows.filter((r) => r.status === 'resolved').length,
  };
}

export async function fetchCategoryStats(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('reports')
    .select('category');

  if (error) throw error;

  const map: Record<string, number> = {};
  for (const row of data as { category: string }[]) {
    map[row.category] = (map[row.category] || 0) + 1;
  }
  return map;
}

export interface NewReportInput {
  category: Report['category'];
  description: string;
  address: string;
  lat: number;
  lng: number;
  photoUrl: string | null;
}

export async function uploadPhoto(
  file: File,
  objectId: string,
): Promise<string> {
  console.log('[PHOTO_UPLOAD_START] objectId=', objectId, 'file=', file.name, 'size=', file.size);

  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${objectId}.${ext}`;

  const { error } = await supabase.storage
    .from('report-images')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.error('[PHOTO_UPLOAD_ERROR]', error);
    throw error;
  }

  console.log('[PHOTO_UPLOAD_SUCCESS] path=', path);

  const { data: urlData } = supabase.storage
    .from('report-images')
    .getPublicUrl(path);

  const publicUrl = urlData.publicUrl;
  console.log('[PHOTO_URL_CREATED] url=', publicUrl);

  return publicUrl;
}

export async function createReport(input: NewReportInput): Promise<Report> {
  console.log('[REPORT_CREATE_START] category=', input.category, 'hasPhotoUrl=', !!input.photoUrl);

  const row = {
    category: input.category,
    description: input.description,
    address: input.address,
    latitude: input.lat,
    longitude: input.lng,
    photo_url: input.photoUrl,
    status: 'new' as ReportStatus,
  };

  const { data, error } = await supabase
    .from('reports')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    console.error('[REPORT_CREATE_ERROR]', error);
    throw error;
  }

  const report = rowToReport(data as ReportRow);
  // Record only the ID returned by a successful INSERT, never guesses/legacy reports.
  if (typeof window !== 'undefined') {
    try { rememberCreatedReport(report.id); } catch { /* saved report remains successful */ }
  }
  console.log('[REPORT_CREATED] reportId=', report.id);
  return report;
}

export async function createReportWithPhoto(
  input: NewReportInput,
  file: File,
): Promise<Report> {
  // Anon cannot UPDATE reports. Upload first, then INSERT with photo_url set.
  const photoUrl = await uploadPhoto(file, crypto.randomUUID());
  return createReport({
    ...input,
    photoUrl,
  });
}

export async function routeReport(reportId: string): Promise<{
  success: true;
  reportId: string;
  organizationId: string | null;
  requiresManualRouting?: boolean;
}> {
  console.log('[CLIENT_ROUTE_START] reportId=', reportId);

  const response = await fetch('/api/reports/' + reportId, {
    method: 'POST',
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    const message = data.error || data.details || 'Unknown routing error';
    console.error('[CLIENT_ROUTE_FAILED]', message);
    throw new Error(message);
  }

  console.log('[CLIENT_ROUTE_SUCCESS] organizationId=', data.organizationId);
  return data;
}

export async function updateReportStatus(
  id: string,
  status: ReportStatus,
): Promise<Report> {
  const update: Partial<ReportRow> = {
    status,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
  };

  const { data, error } = await supabase
    .from('reports')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return rowToReport(data as ReportRow);
}

export async function buildStatusHistory(
  reportId: string,
  createdAt: string,
  updatedAt: string,
  resolvedAt: string | null,
  currentStatus: ReportStatus,
): Promise<StatusHistoryEntryLike[]> {
  // Try to get persistent events first
  try {
    const events = await getReportEvents(reportId);
    if (events.length > 0) {
      return convertEventsToHistory(events);
    }
  } catch (error) {
    console.error('Error fetching report events, falling back to client-side logic:', error);
  }

  // Fallback to client-side logic for backward compatibility
  const history: StatusHistoryEntryLike[] = [
    {
      status: 'new',
      date: createdAt,
      comment: 'Обращение зарегистрировано в системе',
      author: 'Система',
    },
  ];

  if (currentStatus === 'in_progress' || currentStatus === 'resolved') {
    history.push({
      status: 'in_progress',
      date: updatedAt,
      comment: 'Заявка передана в профильную службу',
      author: 'Исполнитель',
    });
  }

  if (currentStatus === 'resolved' && resolvedAt) {
    history.push({
      status: 'resolved',
      date: resolvedAt,
      comment: 'Проблема устранена. Работы завершены.',
      author: 'Исполнитель',
    });
  }

  return history;
}

interface StatusHistoryEntryLike {
  status?: ReportStatus;
  title?: string;
  date: string;
  comment?: string;
  author: string;
}

// Authenticated operational queue is scoped inside PostgreSQL, never by a caller's organization ID.
export async function fetchOperationalReports(): Promise<Report[]> {
  const {data,error}=await supabase.rpc('get_operational_reports');
  if(error)throw error;
  return Promise.all((data as ReportRow[]).map(async row=>{
    const report=rowToReport(row);
    const {data:count}=await supabase.rpc('get_report_support_count',{p_report_id:report.id});
    return {...report,supportCount:count??0};
  }));
}
