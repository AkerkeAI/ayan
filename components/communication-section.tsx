'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase-client';
async function staffFetch(url:string,init:RequestInit={}) {
 const {data:{session}}=await supabase.auth.getSession();
 return fetch(url,{...init,headers:{...init.headers,Authorization:`Bearer ${session?.access_token??''}`}});
}
import { Report } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Send, Edit2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface OrganizationMessage {
  id: string;
  report_id: string;
  organization_id: string;
  direction: 'outbound' | 'inbound';
  channel: string;
  destination: string;
  subject?: string;
  body: string;
  status: 'draft' | 'sending' | 'sent' | 'error' | 'received';
  created_at: string;
  sent_at?: string;
}

interface Organization {
  id: string;
  name: string;
  category: string;
  channel: string;
  destination: string;
  active: boolean;
}

interface CommunicationSectionProps {
  report: Report;
}

export function CommunicationSection({ report }: CommunicationSectionProps) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [message, setMessage] = useState<OrganizationMessage | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedBody, setEditedBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadOrganization();
    loadLatestMessage();
  }, [report.id]);

  const loadOrganization = async () => {
    if (!report.organizationId) {
      setOrganization(null);
      return;
    }

    try {
      const response = await staffFetch(`/api/organizations?id=${report.organizationId}`);
      if (!response.ok) {
        console.error('Organization API returned error:', response.status);
        setOrganization(null);
        return;
      }
      const data = await response.json();
      if (data.organization) {
        setOrganization(data.organization);
      } else {
        setOrganization(null);
      }
    } catch (error) {
      console.error('Error loading organization:', error);
      setOrganization(null);
    }
  };

  const loadLatestMessage = async () => {
    try {
      const response = await staffFetch(`/api/messages/report/${report.id}?latest=true`);
      if (!response.ok) {
        console.error('Messages API returned error:', response.status);
        return;
      }
      const data = await response.json();
      if (data.message) {
        setMessage(data.message);
        setEditedBody(data.message.body || '');
      }
    } catch (error) {
      console.error('Error loading message:', error);
    }
  };

  const generateMessage = async () => {
    if (!organization) {
      toast.error('Сначала назначьте организацию');
      return;
    }

    setGenerating(true);
    try {
      const response = await staffFetch('/api/messages/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: report.id,
          organizationId: organization.id,
        }),
      });

      const data = await response.json();
      if (data.success && data.message) {
        setMessage(data.message);
        setEditedBody(data.message.body);
        toast.success('Сообщение сгенерировано');
      } else {
        toast.error('Ошибка генерации сообщения');
      }
    } catch (error) {
      console.error('Error generating message:', error);
      toast.error('Ошибка генерации сообщения');
    } finally {
      setGenerating(false);
    }
  };

  const saveEdit = async () => {
    if (!message) return;

    setLoading(true);
    try {
      const response = await staffFetch(`/api/messages/${message.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editedBody }),
      });

      const data = await response.json();
      if (data.success) {
        setMessage({ ...message, body: editedBody });
        setIsEditing(false);
        toast.success('Сообщение сохранено');
      } else {
        toast.error('Ошибка сохранения');
      }
    } catch (error) {
      console.error('Error saving message:', error);
      toast.error('Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  const deleteMessage = async () => {
    if (!message) return;

    if (!confirm('Удалить черновик сообщения?')) return;

    setLoading(true);
    try {
      const response = await staffFetch(`/api/messages/${message.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        setMessage(null);
        toast.success('Сообщение удалено');
      } else {
        toast.error('Ошибка удаления');
      }
    } catch (error) {
      console.error('Error deleting message:', error);
      toast.error('Ошибка удаления');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
      draft: { label: 'Черновик', variant: 'secondary' },
      sending: { label: 'Отправка', variant: 'default' },
      sent: { label: 'Отправлено', variant: 'default' },
      error: { label: 'Ошибка', variant: 'destructive' },
      received: { label: 'Получен ответ', variant: 'default' },
    };
    const statusInfo = statusMap[status] || { label: status, variant: 'secondary' };
    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleString('ru-RU');
    } catch {
      return dateString;
    }
  };

  const getChannelLabel = (channel: string) => {
    const labels: Record<string, string> = {
      whatsapp: 'WhatsApp',
      telegram: 'Telegram',
      email: 'Email',
      api: 'API',
      web: 'Web',
    };
    return labels[channel] || channel;
  };

  if (!organization) {
    return (
      <div className="text-sm text-muted-foreground">
        Организация не назначена. Сначала выполните маршрутизацию обращения.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Organization info */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-foreground">{organization.name}</div>
          <div className="text-xs text-muted-foreground">
            {getChannelLabel(organization.channel)} • {organization.category}
          </div>
        </div>
        <Badge variant="outline">{organization.active ? 'Активна' : 'Неактивна'}</Badge>
      </div>

      {/* Message section */}
      {message ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusBadge(message.status)}
            <span className="text-xs text-muted-foreground">
              {formatDate(message.created_at)}
            </span>
          </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={generateMessage}
                disabled={generating}
                title="Перегенерировать"
              >
                <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
              </Button>
              {message.status === 'draft' && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditing(!isEditing)}
                    title="Редактировать"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={deleteMessage}
                    disabled={loading}
                    title="Удалить"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>

          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={6}
                className="text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                  Отмена
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Сохранить
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              {message.subject && (
                <div className="font-medium mb-2">{message.subject}</div>
              )}
              <div className="whitespace-pre-wrap">{message.body}</div>
            </div>
          )}

          {/* Disabled send button - not connected yet */}
          {message.status === 'draft' && (
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                disabled
                className="flex-1"
              >
                <Send className="h-4 w-4 mr-2" />
                Отправить
              </Button>
              <span className="text-xs text-muted-foreground">
                Интеграция с {getChannelLabel(organization.channel)} пока не подключена
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Button
            variant="outline"
            size="sm"
            onClick={generateMessage}
            disabled={generating}
            className="w-full"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Генерация...
              </>
            ) : (
              'Сгенерировать сообщение'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
