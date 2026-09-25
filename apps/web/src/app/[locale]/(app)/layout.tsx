import { type ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSupabaseServerClient } from '../../../lib/supabase/server';
import { createServerApiClient } from '../../../lib/api/server';
import { ApiError } from '../../../lib/api/client';
import { STORE_COOKIE, readStoreCookie } from '../../../lib/store';
import type { TenantSummary } from '../../../lib/api/types';
import { SessionProvider, StoreProvider } from '../../../components/providers';
import { AppShell } from '../../../components/shell/app-shell';
import { EmptyState } from '../../../components/ui/empty-state';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const cookieStore = await cookies();
  const storeId = readStoreCookie(cookieStore.get(STORE_COOKIE)?.value);
  if (!storeId) redirect(`/${locale}/select-store`);

  const api = await createServerApiClient();
  let store: TenantSummary | undefined;
  let apiDown = false;
  if (!api) {
    redirect(`/${locale}/login`);
  } else {
    try {
      const memberships = await api.get<TenantSummary[]>('/tenants');
      store = memberships.find((membership) => membership.id === storeId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) redirect(`/${locale}/login`);
      apiDown = true;
    }
  }

  if (!apiDown && !store) redirect(`/${locale}/select-store`);

  if (apiDown) {
    const t = await getTranslations({ locale, namespace: 'errors' });
    return (
      <main className="auth-layout">
        <EmptyState
          icon="alert-circle"
          title={t('apiUnavailableTitle')}
          body={t('apiUnavailableBody')}
        />
      </main>
    );
  }

  return (
    <SessionProvider user={user}>
      <StoreProvider store={{ id: store!.id, name: store!.name, role: store!.role }}>
        <AppShell>{children}</AppShell>
      </StoreProvider>
    </SessionProvider>
  );
}
