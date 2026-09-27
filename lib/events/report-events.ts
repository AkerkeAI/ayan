/**
 * Report Events Service
 *
 * Handles creating and retrieving report events for the persistent
 * event history system.
 */

import { supabase } from '@/lib/supabase-client';
import { ReportStatus } from '@/lib/types';

/**
 * Report event data
 */
export interface ReportEvent {
  id: string;
  report_id: string;
  event_type: string;
  title: string;
  description?: string;
  actor_type: string;
  actor_user_id?: string;
  organization_id?: string;
  created_at: string;
}

/**
 * Create a report event
 */
export async function createReportEvent(
  reportId: string,
  eventType: string,
  title: string,
  description?: string,
  actorType: string = 'system',
  actorUserId?: string,
  organizationId?: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('report_events')
      .insert({
        report_id: reportId,
        event_type: eventType,
        title,
        description,
        actor_type: actorType,
        actor_user_id: actorUserId,
        organization_id: organizationId,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating report event:', error);
      return null;
    }

    return data.id;
  } catch (error) {
    console.error('Error creating report event:', error);
    return null;
  }
}

/**
 * Get events for a report
 */
export async function getReportEvents(reportId: string): Promise<ReportEvent[]> {
  try {
    const { data, error } = await supabase
      .from('report_events')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching report events:', error);
      return [];
    }

    return data as ReportEvent[];
  } catch (error) {
    console.error('Error fetching report events:', error);
    return [];
  }
}

/**
 * Get the latest event for a report
 */
export async function getLatestReportEvent(reportId: string): Promise<ReportEvent | null> {
  try {
    const { data, error } = await supabase
      .from('report_events')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching latest report event:', error);
      return null;
    }

    return data as ReportEvent | null;
  } catch (error) {
    console.error('Error fetching latest report event:', error);
    return null;
  }
}

interface HistoryEntry {
  status?: ReportStatus;
  title?: string;
  date: string;
  comment: string;
  author: string;
}

/**
 * Convert report events to the format expected by the UI
 * This bridges the new persistent events with the existing UI
 */
export function convertEventsToHistory(
  events: ReportEvent[]
): HistoryEntry[] {
  return events.map(event => ({
    status: event.event_type.startsWith('resolution_') ? undefined : mapEventTypeToStatus(event.event_type),
    title: event.title,
    date: event.created_at,
    comment: event.description || event.title,
    author: mapActorTypeToAuthor(event.actor_type, event.organization_id),
  }));
}

/**
 * Map event type to status for UI compatibility
 */
function mapEventTypeToStatus(eventType: string): ReportStatus {
  const statusMap: Record<string, ReportStatus> = {
    report_created: 'new',
    routed: 'in_progress',
    message_prepared: 'in_progress',
    message_sent: 'in_progress',
    organization_replied: 'in_progress',
    status_changed: 'in_progress',
  };

  return statusMap[eventType] ?? 'new';
}

/**
 * Map actor type to author display name
 */
function mapActorTypeToAuthor(actorType: string, organizationId?: string): string {
  const authorMap: Record<string, string> = {
    'system': 'Система',
    'operator': 'Исполнитель',
    'organization': 'Организация',
    'ai': 'ИИ',
    'developer': 'Оператор Aýan',
    'resident': 'Житель (анонимно)',
  };
  return authorMap[actorType] || 'Система';
}
