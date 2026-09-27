'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, LogOut, Shield } from 'lucide-react';
import { toast } from 'sonner';

interface OperatorLoginModalProps {
  variant?: 'sidebar' | 'footer';
}

export function OperatorLoginModal({ variant = 'sidebar' }: OperatorLoginModalProps) {
  const { user, login, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const role = await login(email, password);
      router.push(role === 'developer' ? '/dashboard/review' : role === 'operator' ? '/dashboard' : '/dashboard/reports');
      toast.success('Вход выполнен успешно');
      setOpen(false);
      setEmail('');
      setPassword('');
    } catch (error: any) {
      toast.error(error.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Вы вышли из системы');
    } catch (error: any) {
      toast.error(error.message || 'Ошибка выхода');
    }
  };

  // If user is authenticated and is operator, show logout button
  if (user) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleLogout}
        className={variant === 'footer' ? 'text-white/70 hover:text-white' : 'text-white/60 hover:text-white w-full justify-start'}
      >
        <LogOut className="h-4 w-4 mr-2" />
        Выйти
      </Button>
    );
  }

  // If user is authenticated but not operator, show nothing
  

  // Show login button for non-authenticated users
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={
            variant === 'footer'
              ? 'text-white/70 hover:text-white'
              : 'text-white/60 hover:text-white w-full justify-start'
          }
        >
          <Shield className="h-4 w-4 mr-2" />
          Вход для исполнителя / оператора Aýan
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Вход для исполнителя / оператора Aýan</DialogTitle>
          <DialogDescription>
            Введите свои учетные данные для доступа к панели управления
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="operator@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Вход...
                </>
              ) : (
                'Войти'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
