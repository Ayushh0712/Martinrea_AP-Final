'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { extractApiError } from '@/lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

const DEMO_ACCOUNTS = [
  { role: 'AP Clerk', email: 'clerk@martinrea.dev', password: 'Password123!' },
  { role: 'Plant Manager', email: 'pm@martinrea.dev', password: 'Password123!' },
  { role: 'Finance Director', email: 'fd@martinrea.dev', password: 'Password123!' },
] as const;

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const router = useRouter();

  const [showPassword, setShowPassword] = useState(false);
  const [demoPending, setDemoPending] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // Already signed in (e.g. visited /login directly) — bounce to the app.
  // Middleware also enforces this server-side; this covers client navigations.
  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, router]);

  if (isAuthenticated) {
    return null;
  }

  const doLogin = async (email: string, password: string) => {
    await login(email, password);
    toast.success('Welcome back');
    router.replace('/dashboard');
  };

  const onSubmit = handleSubmit(async (data) => {
    try {
      await doLogin(data.email, data.password);
    } catch (err) {
      toast.error(extractApiError(err, 'Login failed'));
    }
  });

  const handleDemoLogin = async (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setValue('email', account.email);
    setValue('password', account.password);
    setDemoPending(account.role);
    try {
      await doLogin(account.email, account.password);
    } catch (err) {
      toast.error(extractApiError(err, 'Login failed'));
    } finally {
      setDemoPending(null);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-sidebar px-4 py-10">
      {/* Soft brand glow accents for depth */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-[460px] w-[460px] rounded-full bg-brand/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 -bottom-24 h-[380px] w-[380px] rounded-full bg-brand-600/20 blur-3xl" />

      <div className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-elevated ring-1 ring-black/5 sm:p-9">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center">
          <img
            src="/martinrea-logo.png"
            alt="Martinrea"
            className="h-16 w-auto object-contain"
          />
          <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-ink">
            Martinrea - AP
          </h1>
          <span className="mt-3 h-px w-full bg-line" />
          <p className="mt-4 text-sm text-ink-muted">
            Welcome back! Please sign in to continue.
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-7 grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                className="pl-9"
                placeholder="you@martinrea.dev"
                {...register('email')}
              />
            </div>
            {errors.email && (
              <p className="text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="pl-9 pr-9"
                placeholder="Enter your password"
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-ink"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              className="text-[12px] font-medium text-brand hover:underline"
              onClick={() =>
                toast.info(
                  'Password reset flow ships in Phase 2. Use the seeded credentials below for now.',
                )
              }
            >
              Forgot password?
            </button>
          </div>

          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              'Sign In'
            )}
          </Button>
        </form>

        {/* One-tap role logins — seeded backend credentials for quick sign-in */}
        <div className="mt-7">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
              One-tap sign-in
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="mt-4 grid gap-2">
            {DEMO_ACCOUNTS.map((account) => {
              const pending = demoPending === account.role;
              return (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => handleDemoLogin(account)}
                  disabled={isSubmitting || demoPending !== null}
                  className="group flex items-center justify-between rounded-md border border-line bg-white px-3.5 py-2.5 text-left transition hover:border-brand-200 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex flex-col">
                    <span className="text-[13px] font-medium text-ink">
                      {account.role}
                    </span>
                    <span className="text-[11.5px] text-ink-muted">
                      {account.email}
                    </span>
                  </span>
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin text-brand" />
                  ) : (
                    <span className="text-[11.5px] font-medium text-brand opacity-0 transition group-hover:opacity-100">
                      Sign in →
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-center text-[11.5px] text-ink-muted">
            Password for all accounts:{' '}
            <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink">
              Password123!
            </code>
          </p>
        </div>

        <p className="mt-7 text-center text-[12px] text-ink-muted">
          Need help?{' '}
          <a
            href="mailto:ap-platform@martinrea.com"
            className="font-medium text-brand hover:underline"
          >
            Contact your AP administrator
          </a>
        </p>
      </div>
    </div>
  );
}
