/**
 * Organization Messages Service
 *
 * Handles storing and retrieving organization messages (outbound and inbound).
 * This service manages the draft and sent states of messages.
 */

import { supabase } from '@/lib/supabase-client';
import { getProvider } from './providers';

/**
 * Organization message data
 */
export interface OrganizationMessage {
  id: string;
  report_id: string;
  organization_id: string;
  direction: 'outbound' | 'inbound';
  channel: string;
  destination: string;
  subject?: string;
  body: string;
  status: 'draft' | 'sending' | 'sent' | 'error' | 'received';
  provider_message_id?: string;
  created_at: string;
  sent_at?: string;
}

/**
 * Message creation input
 */
export interface CreateMessageInput {
  reportId: string;
  organizationId: string;
  direction: 'outbound' | 'inbound';
  channel: string;
  destination: string;
  subject?: string;
  body: string;
  status?: 'draft' | 'sending' | 'sent' | 'error' | 'received';
}

/**
 * Create an organization message
 */
export async function createOrganizationMessage(input: CreateMessageInput, db = supabase): Promise<OrganizationMessage | null> {
  try {
    const { data, error } = await db
      .from('organization_messages')
      .insert({
        report_id: input.reportId,
        organization_id: input.organizationId,
        direction: input.direction,
        channel: input.channel,
        destination: input.destination,
        subject: input.subject,
        body: input.body,
        status: input.status || 'draft',
      })
      .select('*')
      .single();

    if (error) {
      console.error('Error creating organization message:', error);
      return null;
    }

    return data as OrganizationMessage;
  } catch (error) {
    console.error('Error creating organization message:', error);
    return null;
  }
}

/**
 * Get messages for a report
 */
export async function getReportMessages(reportId: string): Promise<OrganizationMessage[]> {
  try {
    const { data, error } = await supabase
      .from('organization_messages')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching report messages:', error);
      return [];
    }

    return data as OrganizationMessage[];
  } catch (error) {
    console.error('Error fetching report messages:', error);
    return [];
  }
}

/**
 * Get the latest draft message for a report
 */
export async function getLatestDraftMessage(reportId: string): Promise<OrganizationMessage | null> {
  try {
    const { data, error } = await supabase
      .from('organization_messages')
      .select('*')
      .eq('report_id', reportId)
      .eq('status', 'draft')
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching latest draft message:', error);
      return null;
    }

    return data as OrganizationMessage | null;
  } catch (error) {
    console.error('Error fetching latest draft message:', error);
    return null;
  }
}

/**
 * Update message status
 */
export async function updateMessageStatus(
  messageId: string,
  status: 'draft' | 'sending' | 'sent' | 'error' | 'received',
  providerMessageId?: string
): Promise<boolean> {
  try {
    const updateData: any = { status };
    
    if (status === 'sent') {
      updateData.sent_at = new Date().toISOString();
    }
    
    if (providerMessageId) {
      updateData.provider_message_id = providerMessageId;
    }

    const { error } = await supabase
      .from('organization_messages')
      .update(updateData)
      .eq('id', messageId);

    if (error) {
      console.error('Error updating message status:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error updating message status:', error);
    return false;
  }
}

/**
 * Update message body (for manual editing)
 */
export async function updateMessageBody(messageId: string, body: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('organization_messages')
      .update({ body })
      .eq('id', messageId);

    if (error) {
      console.error('Error updating message body:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error updating message body:', error);
    return false;
  }
}

/**
 * Delete a message
 */
export async function deleteMessage(messageId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('organization_messages')
      .delete()
      .eq('id', messageId);

    if (error) {
      console.error('Error deleting message:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting message:', error);
    return false;
  }
}

/**
 * Generate and store an organization message using AI
 */
export async function generateAndStoreMessage(
  reportId: string,
  organizationId: string,
  reportData: any,
  organizationData: any,
  db = supabase
): Promise<OrganizationMessage | null> {
  try {
    // Import AI message generation (server-side only)
    const { generateOrganizationMessage, generateFallbackMessage } = await import('@/lib/ai/message-generation');

    // Try AI generation first
    const generated = await generateOrganizationMessage(reportData, organizationData);

    // Fallback to template if AI fails
    const message = generated || generateFallbackMessage(reportData, organizationData);

    // Get provider to format the message
    const provider = getProvider(organizationData.channel);
    const formatted = provider.formatMessage({
      reportId,
      organizationId,
      organizationName: organizationData.name,
      channel: organizationData.channel,
      destination: organizationData.destination,
      subject: message.subject,
      body: message.message,
      language: message.language,
    });

    // Store the message as draft
    const stored = await createOrganizationMessage({
      reportId,
      organizationId,
      direction: 'outbound',
      channel: organizationData.channel,
      destination: organizationData.destination,
      subject: formatted.subject,
      body: formatted.body,
      status: 'draft',
    }, db);

    if (stored) {
      await db.rpc('create_report_event',{p_report_id:reportId,p_event_type:'message_prepared',p_title:'Сообщение подготовлено',p_description:`Черновик для ${organizationData.name}`,p_organization_id:organizationId});
    }

    return stored;
  } catch (error) {
    console.error('Error generating and storing message:', error);
    return null;
  }
}

/**
 * Get message status label in Russian
 */
export function getMessageStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    'draft': 'Черновик',
    'sending': 'Отправка',
    'sent': 'Отправлено',
    'error': 'Ошибка',
    'received': 'Получен ответ',
  };
  return labels[status] || status;
}
