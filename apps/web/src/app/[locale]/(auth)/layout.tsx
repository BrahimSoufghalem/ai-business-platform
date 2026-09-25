import { Suspense, type ReactNode } from 'react';
import { LocaleSwitcher } from '../../../components/shell/locale-switcher';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <div className="auth-locale">
        <Suspense><LocaleSwitcher /></Suspense>
      </div>
      {children}
    </main>
  );
}
