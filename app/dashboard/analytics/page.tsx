'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DashboardLayout } from '@/components/dashboard-layout';
import { useAuth } from '@/lib/auth-context';
import { fetchAnalytics, formatResolutionTime, type AnalyticsData, type TimeFilter } from '@/lib/analytics';
import { CATEGORY_LABELS, type ReportCategory } from '@/lib/types';
import { getCategoryLabel } from '@/lib/categories';
import { fetchSystemicIssues } from '@/lib/systemic-intelligence';
import { AnalyticsInsights } from '@/components/analytics-insights';
import { ServiceIntelligence, type SystemicState } from '@/components/service-intelligence';

const Heatmap = dynamic(() => import('@/components/heatmap-map').then(m => m.HeatmapMap), {
  ssr: false, loading: () => <div className="h-[380px] animate-pulse rounded-xl bg-slate-900 md:h-[560px]" aria-label="Загрузка карты" />,
});
type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AnalyticsData };
const date = (value: string) => new Date(value).toLocaleDateString('ru-RU',{timeZone:'Asia/Aqtau'});

export default function AnalyticsPage() {
  const router = useRouter();
  const { isOperator, isLoading: authLoading } = useAuth();
  const [days,setDays] = useState<TimeFilter>(30);
  const [category,setCategory] = useState<string | null>(null);
  const [state,setState] = useState<LoadState>({ status:'loading' });
  const [retry,setRetry] = useState(0);
  const [selected,setSelected] = useState<string | null>(null);
  const [systemic,setSystemic] = useState<SystemicState>({status:'loading'});
  const [systemicRetry,setSystemicRetry] = useState(0);
  const selectZone = useCallback((id: string) => setSelected(id),[]);
  useEffect(() => {
    if (!authLoading && !isOperator) router.replace('/');
  },[authLoading,isOperator,router]);
  useEffect(() => {
    if (authLoading || !isOperator) return;
    let cancelled = false;
    setState({status:'loading'}); setSelected(null);
    fetchAnalytics(days,category).then(data => {
      if (!cancelled) setState({status:'ready',data});
    }).catch(() => { if (!cancelled) setState({status:'error'}); });
    return () => { cancelled = true; };
  },[days,category,retry,authLoading,isOperator]);
  useEffect(() => {
    if (authLoading || !isOperator) return;
    let active=true; setSystemic({status:'loading'});
    fetchSystemicIssues(days,category).then(data=>{if(active)setSystemic({status:'ready',data});})
      .catch(()=>{if(active)setSystemic({status:'error'});});
    return()=>{active=false;};
  },[days,category,systemicRetry,authLoading,isOperator]);
  // All hooks run on every render, including while authentication is loading.
  if (authLoading || !isOperator) return null;
  const data = state.status === 'ready' ? state.data : null;
  const zone = data?.hotspots.find(item => item.hotspot_id===selected);
  const period = days===null ? 'Всё время' : `Последние ${days} дней`;
  return <DashboardLayout>
    <div className="min-w-0 space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Aýan · City Intelligence</p>
        <h1 className="mt-1 text-2xl font-bold text-navy sm:text-3xl">Городская аналитика</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Здесь видно, где проблемы повторяются и какие из них возвращаются со временем.</p>
      </header>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-3">
        <div role="group" aria-label="Период аналитики" className="flex flex-wrap gap-1">
          {([7,30,90,null] as TimeFilter[]).map(value => <button key={value??'all'} aria-pressed={days===value}
            onClick={() => setDays(value)} className={`rounded-lg px-3 py-2 text-sm ${days===value?'bg-navy text-white':'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
            {value===null?'Всё время':`${value} дней`}</button>)}
        </div>
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-600">Категория
          <select aria-label="Категория аналитики" className="max-w-full rounded-lg border bg-white px-3 py-2" value={category??''} onChange={e=>setCategory(e.target.value||null)}>
            <option value="">Все категории</option>
            {(Object.keys(CATEGORY_LABELS) as ReportCategory[]).map(key=><option key={key} value={key}>{getCategoryLabel(key)}</option>)}
          </select>
        </label>
      </div>
      {state.status==='loading' && <div role="status" className="rounded-xl border bg-white p-8 text-center text-slate-500">Загрузка аналитики…</div>}
      {state.status==='error' && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h2 className="font-semibold text-red-900">Не удалось загрузить аналитику.</h2>
        <p className="mt-1 text-sm text-red-800">Данные недоступны. Это ошибка загрузки, а не отсутствие обращений. Повторите попытку; если ошибка остаётся, обратитесь к администратору.</p>
        <button onClick={()=>setRetry(n=>n+1)} className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium text-red-900">Повторить загрузку</button>
      </div>}
      {data && <>
        <AnalyticsInsights key={`${days}-${category}-${retry}-${systemicRetry}`} days={days} category={category}/>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {[
            ['Активные обращения',data.kpis.active_reports],['Подтверждённо решено',data.kpis.verified_resolved],
            ['Повторно открыто',data.kpis.reopened_reports],['Проблемные зоны',data.hotspots.length],
          ].map(([label,value])=><div key={label} className="rounded-xl border bg-white px-4 py-3"><div className="text-2xl font-semibold text-navy">{value}</div><div className="mt-1 text-xs text-slate-500">{label}</div></div>)}
        </div>
        <section aria-labelledby="heatmap-title" className="min-w-0 rounded-2xl border border-slate-800 bg-[#0c1e32] p-3 text-white sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div><h2 id="heatmap-title" className="text-lg font-semibold">Карта концентрации проблем</h2>
              <p className="mt-1 text-xs text-slate-300">{period} · {category?getCategoryLabel(category as ReportCategory):'Все категории'} · {data.points.length} точек из {data.kpis.total_reports} обращений</p></div>
            <span className="rounded-full border border-cyan-800 px-3 py-1 text-xs text-cyan-200">Реальные координаты</span>
          </div>
          <Heatmap points={data.points} hotspots={data.hotspots} selected={selected} onSelect={selectZone} onReset={()=>setSelected(null)} systemicIds={systemic.status==='ready'?systemic.data.issues.map(issue=>issue.hotspot_id):[]}/>
          {data.points.length===0 && <p className="mt-3 text-sm text-slate-300">{data.kpis.total_reports===0?'За выбранный период обращений нет.':'У выбранных обращений нет корректных координат для карты.'}</p>}
          <details className="mt-3 text-xs text-slate-400"><summary className="cursor-pointer">Как читать карту?</summary><p className="mt-2">Интенсивность объединяет близкие обращения. Поддержка +1 увеличивает вес одной точки не более чем на 50%. Номера обозначают выявленные зоны; сиреневая обводка — системные проблемы.</p></details>
          {zone && <div className="mt-4 rounded-xl border border-cyan-900 bg-slate-950/40 p-4" aria-live="polite">
            <h3 className="font-semibold text-cyan-100">{getCategoryLabel(zone.category as ReportCategory)} · выбранная зона</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {[['Обращения',zone.report_count],['Поддержка +1',zone.total_support_count],['Активные',zone.active_count],['Подтверждено',zone.verified_resolved_count],['Повторно открыто',zone.reopened_count]].map(([label,value])=><div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
              <div><dt className="text-xs text-slate-400">Первое / последнее</dt><dd className="mt-1">{date(zone.first_report_date)} — {date(zone.latest_report_date)}</dd></div>
            </dl>
          </div>}
        </section>
        <section className="rounded-xl border bg-white p-4 sm:p-5">
          <h2 className="font-semibold text-navy">Повторяющиеся проблемы</h2>
          <p className="mt-1 text-xs text-slate-500">Участки, где рядом появились похожие обращения.</p><details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Как это определяется?</summary><p className="mt-2">Не менее 3 обращений одной категории, связанных расстоянием до 150 м. Раздельные группы считаются отдельно.</p></details>
          {data.hotspots.length===0 ? <p className="mt-4 text-sm text-slate-500">Повторяющихся проблем пока не выявлено.</p> :
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.hotspots.map((item,index)=><button key={item.hotspot_id} onClick={()=>setSelected(item.hotspot_id)} aria-pressed={selected===item.hotspot_id}
              className={`rounded-xl border p-4 text-left transition-colors ${selected===item.hotspot_id?'border-cyan-600 bg-cyan-50':'border-slate-200 hover:bg-slate-50'}`}>
              <span className="text-sm font-semibold text-navy">{index+1}. {getCategoryLabel(item.category as ReportCategory)}</span>
              <span className="mt-2 block text-sm text-slate-600">{item.report_count} обращений · +1: {item.total_support_count}</span>
              <span className="mt-2 block text-xs text-slate-500">{date(item.first_report_date)} — {date(item.latest_report_date)}</span>
              <span className="mt-3 block text-xs font-medium text-primary">Показать на карте ↑</span>
            </button>)}</div>}
        </section>
        <ServiceIntelligence days={days} category={category} systemic={systemic} onRetry={()=>setSystemicRetry(n=>n+1)} onFocus={selectZone}/>
        <section className="min-w-0 rounded-xl border bg-white p-4 sm:p-5">
          <h2 className="font-semibold text-navy">Динамика обращений</h2>
          <p className="mt-1 text-xs text-slate-500">Когда поступали обращения и сколько из них сейчас решено с подтверждением.</p><details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Как считается?</summary><p className="mt-2">По дате создания, часовой пояс Актау. {days===7||days===30?'По дням.':days===90?'По неделям.':'По неделям; для истории более года — по месяцам.'} Решено — только с независимым подтверждением.</p></details>
          {data.trend.length===0 ? <p className="mt-4 text-sm text-slate-500">За выбранный период обращений нет.</p> : <>
            <div className="mt-5 h-64 w-full min-w-0 overflow-hidden" role="img" aria-label={`Динамика: ${data.trend.reduce((sum,p)=>sum+p.report_count,0)} обращений за выбранный период`}>
              <ResponsiveContainer width="100%" height="100%"><BarChart data={data.trend} margin={{top:8,right:4,bottom:0,left:-25}}>
                <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date_label" tick={{fontSize:11}} minTickGap={24}/><YAxis allowDecimals={false} tick={{fontSize:11}}/>
                <Tooltip/><Bar dataKey="report_count" name="Создано" fill="#168ee0" radius={[4,4,0,0]} maxBarSize={48}/>
                <Bar dataKey="resolved_count" name="Подтверждённо решено" fill="#22c5be" radius={[4,4,0,0]} maxBarSize={48}/>
              </BarChart></ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-500">Синий — поступило обращений · Бирюзовый — из них сейчас решено с подтверждением.</p>
          </>}
        </section>
        <section className="rounded-xl border bg-white p-4 sm:p-5">
          <h2 className="font-semibold text-navy">Время подтверждённого решения</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Среднее время</dt><dd className="mt-1 text-lg font-semibold text-navy">{formatResolutionTime(data.kpis.avg_resolution_hours)}</dd></div>
            <div><dt className="text-xs text-slate-500">Медианное время</dt><dd className="mt-1 text-lg font-semibold text-navy">{formatResolutionTime(data.kpis.median_resolution_hours)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">Сколько времени прошло от обращения до подтверждения решения.</p><details className="mt-3 text-xs leading-relaxed text-slate-500"><summary className="cursor-pointer">Как считается?</summary><p className="mt-2">От создания обращения до действующего независимого подтверждения. Повторно открытые и старые решения без независимой проверки исключены из времени решения. Период и категория отбирают обращения по дате создания; «повторно открыто» учитывает всю историю этих обращений, включая отзывы жителей.</p></details>
        </section>
      </>}
    </div>
  </DashboardLayout>;
}
