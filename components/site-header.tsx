'use client';

import {NotificationLink} from '@/components/staff-notifications';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Menu, X, Waves } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

const NAV_LINKS = [
  { href: '/', label: 'Главная' },
  { href: '/map', label: 'Карта проблем' },
  { href: '/my-reports', label: 'Мои обращения' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const {isOperator,isDeveloper,isLoading,logout}=useAuth();
  const staff=!isLoading && (isOperator || isDeveloper);
  const links=staff ? [
    ...(isOperator ? [{href:'/dashboard',label:'Обзор'},{href:'/dashboard/reports',label:'Обращения'},{href:'/dashboard/analytics',label:'Аналитика'}] : [{href:'/dashboard/reports',label:'Обращения'},{href:'/dashboard/review',label:'Проверка решений'},{href:'/dashboard/categories',label:'Новые категории'}]),
    {href:'/',label:'На сайт'},
  ] : NAV_LINKS;
  const signOut=async()=>{try{await logout();setOpen(false);}catch{toast.error('Не удалось выйти. Попробуйте ещё раз.');}};

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-white/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-md">
            <Waves className="h-5 w-5 text-white" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-bold tracking-tight text-navy text-lg">
              Aýan
            </span>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Цифровой город
            </span>
          </div>
        </Link>

        <nav aria-label="Основная навигация" className={cn("hidden items-center gap-1",staff?"lg:flex":"md:flex")}>
          {links.map((link) => {
            const active =
              (link.href === '/' || link.href === '/dashboard')
                ? pathname === '/'
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {link.label}
              </Link>
            );
          })}
          {staff && <NotificationLink main/>}
        </nav>

        <div className="flex items-center gap-2">
          {!staff && <Link
            href="/report"
            className="hidden rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy-light hover:shadow-md sm:inline-flex"
          >
            Сообщить о проблеме
          </Link>}
          {staff && <button onClick={signOut} className="rounded-lg px-3 py-2 text-sm font-medium text-navy hover:bg-muted">Выйти</button>}
          <button
            onClick={() => setOpen(!open)}
            className={cn("rounded-lg p-2 text-navy hover:bg-muted",staff?"lg:hidden":"md:hidden")}
            aria-expanded={open}
            aria-controls="site-mobile-navigation"
            aria-label="Меню"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div id="site-mobile-navigation" className={cn("border-t border-border/60 bg-white",staff?"lg:hidden":"md:hidden")}>
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3">
            {links.map((link) => {
              const active =
                (link.href === '/' || link.href === '/dashboard')
                  ? pathname === '/'
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'rounded-lg px-3 py-2.5 text-sm font-medium',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
            {staff && <NotificationLink main onClick={()=>setOpen(false)}/>}
            {!staff && <Link
              href="/report"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-lg bg-navy px-3 py-2.5 text-center text-sm font-semibold text-white"
            >
              Сообщить о проблеме
            </Link>}
          </nav>
        </div>
      )}
    </header>
  );
}
