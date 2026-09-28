'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { OperatorLoginModal } from '@/components/operator-login-modal';
import {
  LayoutDashboard,
  ListChecks,
  ArrowLeft,
  Globe,
  BarChart3,
} from 'lucide-react';

const NAV = [
  { href: '/dashboard', label: 'Обзор', icon: LayoutDashboard, exact: true, operatorOnly: true },
  { href: '/dashboard/analytics', label: 'Аналитика', icon: BarChart3, exact: false, operatorOnly: true },
  { href: '/dashboard/reports', label: 'Обращения', icon: ListChecks, operatorOnly: false },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const { isOperator, isDeveloper, organizationName } = useAuth();

  return (
    <aside className="flex h-full w-full flex-col bg-navy text-white lg:w-64 lg:fixed lg:top-0 lg:left-0 lg:h-screen">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent">
          <Globe className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="font-bold text-lg leading-none">Aýan</div>
          <div className="text-[10px] text-white/50 uppercase tracking-wider">
            Муниципальная панель
          </div>
        </div>
      </div>

      {isOperator && <p className="border-b border-white/10 px-5 py-3 text-xs text-white/70">{organizationName ?? "Организация пока не назначена"}</p>}
      <nav className="flex-1 px-3 py-4">
        <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Управление
        </div>
        {NAV.filter(item => !item.operatorOnly || isOperator).map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
        {isDeveloper && <Link href="/dashboard/review" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10"><ListChecks className="h-4 w-4"/>Проверка решений</Link>}
        {isDeveloper && <Link href="/dashboard/categories" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10"><ListChecks className="h-4 w-4"/>Новые категории</Link>}
      </nav>

      <div className="border-t border-white/10 p-3 space-y-2">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          На сайт
        </Link>
        <div className="px-3">
          <OperatorLoginModal variant="sidebar" />
        </div>
      </div>
    </aside>
  );
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const {isOperator,organizationId}=useAuth();
  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-col lg:flex-row">
        <DashboardSidebar />
        <main className="flex-1 lg:ml-64">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {isOperator && !organizationId && <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">Ваш аккаунт пока не связан с действующей организацией. Попросите администратора выполнить назначение. Работа с обращениями станет доступна после этого.</div>}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
