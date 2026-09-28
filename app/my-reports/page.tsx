'use client';

import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ReportCard } from '@/components/report-card';
import { fetchMyReports } from '@/lib/my-reports';
import { Report, ReportStatus } from '@/lib/types';
import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, FileText, Loader2, AlertCircle } from 'lucide-react';

const STATUS_FILTERS: { value: 'all' | ReportStatus; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решено' },
];

export default function MyReportsPage() {
  const [filter, setFilter] = useState<'all' | ReportStatus>('all');
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyReports()
      .then((data) => {
        setReports(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? reports : reports.filter((r) => r.status === filter)),
    [reports, filter],
  );

  const stats = useMemo(() => ({
    total: reports.length,
    new: reports.filter((r) => r.status === 'new').length,
    inProgress: reports.filter((r) => r.status === 'in_progress').length,
    resolved: reports.filter((r) => r.status === 'resolved').length,
  }), [reports]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
        >
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy sm:text-3xl">
              Мои обращения
            </h1>
            <p className="mt-1 text-muted-foreground">
              Обращения, отправленные из этого браузера
            </p>
            <p className="mt-2 text-sm text-muted-foreground">При очистке данных браузера или смене устройства история не сохранится. Старые обращения без записи об отправке здесь не отображаются.</p>
          </div>
          <Link
            href="/report"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-navy-light"
          >
            <FileText className="h-4 w-4" />
            Новое обращение
          </Link>
        </div>

        {/* Stats summary */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Всего', value: stats.total, color: 'text-navy', bg: 'bg-navy/5' },
            { label: 'Новые', value: stats.new, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'В работе', value: stats.inProgress, color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: 'Решено', value: stats.resolved, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg ${s.bg}`}>
                <FileText className={`h-4 w-4 ${s.color}`} />
              </div>
              <div className="text-xl font-bold text-navy">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                filter === f.value
                  ? 'bg-navy text-white'
                  : 'bg-white text-muted-foreground border border-border hover:bg-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((r) => (
                <ReportCard key={r.id} report={r} />
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="mt-12 rounded-xl border border-border bg-white p-12 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {reports.length ? 'Нет обращений с этим статусом' : 'Из этого браузера пока нет сохранённых обращений'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
