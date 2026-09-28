'use client';
import { ReportClaim } from '@/components/report-claim';
import { supabase } from '@/lib/supabase-client';
import { toast } from 'sonner';

import { DashboardLayout } from '@/components/dashboard-layout';
import { StatusBadge } from '@/components/status-badge';
import { fetchOperationalReports } from '@/lib/reports';
import { getCategoryIcon, getCategoryLabel } from '@/lib/categories';
import { ReportStatus, STATUS_LABELS, CATEGORY_LABELS, ReportCategory, Report } from '@/lib/types';
import { formatDate } from '@/components/report-card';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, ArrowRight, Loader2, Users } from 'lucide-react';

const STATUS_FILTERS: { value: 'all' | ReportStatus; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решено' },
];

export default function DashboardReportsPage() {
  const {isOperator,isDeveloper,isLoading:authLoading,organizationId}=useAuth();
  const router=useRouter();
  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ReportCategory>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'most_supported' | 'longest_unresolved'>('newest');
  const [reports, setReports] = useState<Report[]>([]);
  const visibleReports=useRef<Report[]>([]);
  visibleReports.current=reports;
  const [loading, setLoading] = useState(true);

  useEffect(()=>{if(!authLoading&&!isOperator&&!isDeveloper)router.replace('/');},[authLoading,isOperator,isDeveloper,router]);
  useEffect(() => {
    if(authLoading||(!isOperator&&!isDeveloper))return;
    let active=true;setLoading(true);setReports([]);
    fetchOperationalReports().then(data=>{if(active){setReports(data);setLoading(false);}}).catch(()=>{if(active)setLoading(false);});
    const refresh=()=>{void fetchOperationalReports().then(data=>{if(active)setReports(data);}).catch(()=>{});};
    const channel=supabase.channel('operational-claims').on('postgres_changes',{event:'UPDATE',schema:'public',table:'reports'},payload=>{
      const changed=payload.new as {id?:string;organization_id?:string};
      if(isOperator&&changed.organization_id&&changed.organization_id!==organizationId&&visibleReports.current.some(r=>r.id===changed.id&&!r.organizationId))toast.info('Задачу уже взяла другая организация');
      refresh();
    }).subscribe();
    window.addEventListener('ayan-claims-changed',refresh);
    const timer=setInterval(refresh,5000);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('ayan-claims-changed',refresh);void supabase.removeChannel(channel);};
  },[authLoading,isOperator,isDeveloper,organizationId]);

  const filtered = useMemo(() => {
    let result = reports.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (isDeveloper && categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.id.toLowerCase().includes(q) &&
          !r.description.toLowerCase().includes(q) &&
          !r.address.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });

    // Apply sorting
    result = result.sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      } else if (sortBy === 'most_supported') {
        const aSupport = a.supportCount || 0;
        const bSupport = b.supportCount || 0;
        return bSupport - aSupport;
      } else if (sortBy === 'longest_unresolved') {
        const aDate = a.status === 'resolved' ? a.resolvedAt : a.createdAt;
        const bDate = b.status === 'resolved' ? b.resolvedAt : b.createdAt;
        return new Date(aDate || 0).getTime() - new Date(bDate || 0).getTime();
      }
      return 0;
    });

    return result;
  }, [reports, statusFilter, categoryFilter, search, sortBy, isDeveloper]);

  if(authLoading||(!isOperator&&!isDeveloper))return null;
  const categories = Object.keys(CATEGORY_LABELS) as ReportCategory[];

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy sm:text-3xl">Обращения</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isDeveloper?'Обращения для независимой проверки':'Доступные задачи и обращения вашей организации'}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === f.value
                  ? 'bg-navy text-white'
                  : 'bg-white text-muted-foreground border border-border hover:bg-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {isDeveloper && <select
            aria-label="Категория обращений"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | ReportCategory)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-navy focus:border-primary focus:outline-none"
          >
            <option value="all">Все категории</option>
            {categories.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'most_supported' | 'longest_unresolved')}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-navy focus:border-primary focus:outline-none"
          >
            <option value="newest">Сначала новые</option>
            <option value="most_supported">Самые поддерживаемые</option>
            <option value="longest_unresolved">Дольше всего нерешенные</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      </div>

      <div className="mb-3 text-sm text-muted-foreground">
        Найдено: <span className="font-semibold text-navy">{filtered.length}</span>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Категория</th>
                  <th className="hidden px-4 py-3 md:table-cell">Адрес</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Дата</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Поддержка</th>
                  <th className="px-4 py-3 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const Icon = getCategoryIcon(r.category);
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-navy">{r.id.slice(0, 8)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-primary" />
                          <span className="text-sm">{getCategoryLabel(r.category)}</span>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell max-w-xs">
                        <span className="truncate">{r.address}</span>
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-muted-foreground sm:table-cell">
                        {formatDate(r.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                        {isOperator && !r.organizationId && <ReportClaim reportId={r.id}/>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {r.supportCount ? 1 + r.supportCount : 1}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/reports/${r.id}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-light"
                        >
                          Открыть
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Обращений не найдено
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
