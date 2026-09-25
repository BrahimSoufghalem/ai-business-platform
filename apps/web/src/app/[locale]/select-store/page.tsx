import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '../../../lib/supabase/server';
import { createServerApiClient } from '../../../lib/api/server';
import type { TenantSummary } from '../../../lib/api/types';
import { SessionProvider } from '../../../components/providers';
import { StorePicker } from './store-picker';

export const dynamic = 'force-dynamic';

export default async function SelectStorePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const api = await createServerApiClient();
  let memberships: TenantSummary[] = [];
  let loadFailed = false;
  if (api) {
    try {
      memberships = await api.get<TenantSummary[]>('/tenants');
    } catch {
      loadFailed = true;
    }
  }

  return (
    <main className="auth-layout">
      <SessionProvider user={user}>
        <StorePicker memberships={memberships} loadFailed={loadFailed} />
      </SessionProvider>
    </main>
  );
}
