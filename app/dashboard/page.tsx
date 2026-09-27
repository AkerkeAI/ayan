'use client';

import { DashboardLayout } from '@/components/dashboard-layout';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CityMap from '@/components/city-map-client';
import { StatusBadge } from '@/components/status-badge';
import { fetchOperationalReports } from '@/lib/reports';
import { Report, ReportStats, ReportCategory } from '@/lib/types';
import { CATEGORY_LABELS } from '@/lib/types';
import { getCategoryIcon, getCategoryLabel, CATEGORY_HEX } from '@/lib/categories';
import { formatDate } from '@/components/report-card';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  FileText,
  Eye,
  Clock,
  CheckCircle2,
  TrendingUp,
  MapPin,
  ArrowRight,
  Flame,
  Loader2,
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { isOperator, organizationId, isLoading: authLoading } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<ReportStats>({ total: 0, new: 0, inProgress: 0, resolved: 0 });
  const [catStats, setCatStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Redirect non-operators
  useEffect(() => {
    if (!authLoading && !isOperator) {
      router.push('/');
    }
  }, [isOperator, authLoading, router]);

  useEffect(() => {
    if(authLoading || !isOperator)return;
    let active=true;setLoading(true);setReports([]);
    fetchOperationalReports().then(r=>{
      if(!active)return;
      setReports(r);setStats({total:r.length,new:r.filter(x=>x.status==='new').length,inProgress:r.filter(x=>x.status==='in_progress').length,resolved:r.filter(x=>x.status==='resolved').length});
      const counts:Record<string,number>={};r.forEach(x=>counts[x.category]=(counts[x.category]??0)+1);setCatStats(counts);setLoading(false);
    }).catch(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[authLoading,isOperator,organizationId]);
  if(authLoading || !isOperator)return null;

  const recent = reports.slice(0, 5);

  const statCards = [
    { label: 'Всего обращений', value: stats.total, icon: FileText, color: 'text-navy', bg: 'bg-navy/5' },
    { label: 'Новые', value: stats.new, icon: Eye, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'В работе', value: stats.inProgress, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Решено', value: stats.resolved, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  ];

  const maxCat = Math.max(...Object.values(catStats), 1);
  const sortedCats = (Object.keys(catStats) as ReportCategory[]).sort(
    (a, b) => catStats[b] - catStats[a],
  );

  // Hotspots: group by microdistrict
  const hotspots: Record<string, number> = {};
  for (const r of reports) {
    const district = r.address.split(',')[0];
    hotspots[district] = (hotspots[district] || 0) + 1;
  }
  const sortedHotspots = Object.entries(hotspots).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy sm:text-3xl">Обзор</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Обращения, назначенные вашей организации
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between">
              <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${s.bg}`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
            </div>
            <div className="mt-3 text-2xl font-bold text-navy sm:text-3xl">{s.value}</div>
            <div className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Map preview */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-navy">Карта обращений</h2>
              <Link href="/map" className="text-xs font-medium text-primary hover:underline">
                Открыть карту
              </Link>
            </div>
            <div className="h-80 overflow-hidden rounded-lg">
              <CityMap reports={reports} height="100%" interactive={false} showPopups={false} />
            </div>
          </div>
        </div>

        {/* Category distribution */}
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-navy">По категориям</h2>
          </div>
          <div className="space-y-3">
            {sortedCats.map((cat) => {
              const count = catStats[cat];
              const pct = (count / maxCat) * 100;
              const hex = CATEGORY_HEX[cat];
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{CATEGORY_LABELS[cat]}</span>
                    <span className="font-semibold text-muted-foreground">{count}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: hex }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hotspots */}
      <div className="mt-4 rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-500" />
          <h2 className="font-semibold text-navy">Проблемные зоны (по районам)</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {sortedHotspots.map(([district, count], i) => (
            <div key={district} className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-1.5">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-red-500 text-white' : i === 1 ? 'bg-orange-500 text-white' : 'bg-navy text-white'}`}>
                  {i + 1}
                </span>
                <span className="text-sm font-semibold text-navy">{count}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{district}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent reports */}
      <div className="mt-4 rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold text-navy">Последние обращения</h2>
          <Link href="/dashboard/reports" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Все обращения <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="divide-y divide-border">
          {recent.map((r) => {
            const Icon = getCategoryIcon(r.category);
            return (
              <Link
                key={r.id}
                href={`/dashboard/reports/${r.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-navy">{r.id.slice(0, 8)}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{getCategoryLabel(r.category)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-foreground">{r.description}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/70">
                    <MapPin className="h-3 w-3" />
                    {r.address}
                  </p>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <StatusBadge status={r.status} />
                  <div className="mt-1 text-xs text-muted-foreground">{formatDate(r.createdAt)}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}
