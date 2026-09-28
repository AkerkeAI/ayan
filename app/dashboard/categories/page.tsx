"use client";
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase-client';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';

type Suggestion = { report_id: string; description: string; photo_url: string; result: { suggested_new_category: string; reason: string; confidence: number } };
type Category = { key: string; name: string; active: boolean };
async function headers() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw Error('Войдите как оператор Aýan');
  return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
}
export default function CategorySuggestions() {
  const { isDeveloper, isLoading } = useAuth();
  const [items, setItems] = useState<Suggestion[]>([]), [categories, setCategories] = useState<Category[]>([]);
  const [page, setPage] = useState(0), [more, setMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!isDeveloper) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/category-suggestions?page=${page}`, { headers: await headers(), cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      setItems(data.suggestions); setCategories(data.categories); setMore(data.hasMore);
    } catch (e) { setItems([]); setError(e instanceof Error ? e.message : 'Ошибка загрузки'); }
    finally { setBusy(false); }
  }, [isDeveloper, page]);
  useEffect(() => { void load(); }, [load]);
  async function review(reportId: string, decision: 'accept' | 'reject', name: string, existingKey: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/category-suggestions', { method: 'POST', headers: await headers(), body: JSON.stringify({ reportId, decision, ...(decision === 'accept' ? (existingKey ? { existingKey } : { name }) : {}) }) });
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Решение не сохранено'); }
    finally { setBusy(false); }
  }
  if (isLoading || !isDeveloper) return <DashboardLayout><p>{isLoading ? 'Проверка доступа…' : 'Доступ только для оператора Aýan'}</p></DashboardLayout>;
  return <DashboardLayout>
    <h1 className="text-2xl font-bold mb-3">Новые категории</h1>
    <p className="mb-4 text-muted-foreground">AI предлагает, оператор Aýan принимает решение. Сначала проверьте существующие категории: близкие по смыслу предложения объединяйте с ними. Исходный выбор жителя «Другое» сохраняется.</p>
    {error && <p role="alert" className="mb-3 text-destructive">{error} <button onClick={() => void load()} disabled={busy}>Обновить</button></p>}
    {busy && <p role="status">Загрузка…</p>}
    {!busy && !error && !items.length && <p>Нет новых предложений.</p>}
    <div className="space-y-4">{items.map(item => <SuggestionCard key={item.report_id} item={item} categories={categories} busy={busy} review={review} />)}</div>
    <div className="flex gap-3 mt-4"><Button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Назад</Button><Button disabled={busy || !more} onClick={() => setPage(page + 1)}>Далее</Button></div>
  </DashboardLayout>;
}
function SuggestionCard({ item, categories, busy, review }: { item: Suggestion; categories: Category[]; busy: boolean; review: (id: string, decision: 'accept' | 'reject', name: string, key: string) => Promise<void> }) {
  const [name, setName] = useState(item.result.suggested_new_category), [existing, setExisting] = useState('');
  return <section className="rounded-xl border bg-white p-4 space-y-3">
    <h2 className="font-semibold">{item.result.suggested_new_category}</h2>
    <Link href={`/dashboard/reports/${item.report_id}`} className="text-primary underline">Обращение {item.report_id.slice(0, 8)}</Link>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={item.photo_url} alt="Фото обращения" className="max-h-64 max-w-full rounded object-contain" />
    <p className="break-words">{item.description}</p><p className="break-words">{item.result.reason}</p><p>Уверенность AI: {Math.round(item.result.confidence * 100)}%</p>
    <label className="block">Существующая категория<select className="block w-full border rounded p-2" value={existing} onChange={e => setExisting(e.target.value)} disabled={busy}><option value="">Создать новую категорию</option>{categories.map(c => <option key={c.key} value={c.key}>{c.name}{c.active ? '' : ' (включить снова)'}</option>)}</select></label>
    {!existing && <label className="block">Название новой категории<input className="block w-full border rounded p-2" value={name} minLength={3} maxLength={60} onChange={e => setName(e.target.value)} disabled={busy} /></label>}
    <div className="flex flex-wrap gap-3"><Button disabled={busy || (!existing && name.trim().length < 3)} onClick={() => void review(item.report_id, 'accept', name, existing)}>{existing ? 'Принять и объединить' : 'Принять и создать категорию'}</Button><Button variant="outline" disabled={busy} onClick={() => void review(item.report_id, 'reject', name, existing)}>Отклонить</Button></div>
  </section>;
}
