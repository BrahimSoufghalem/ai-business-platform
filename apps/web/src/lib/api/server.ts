import 'server-only';
import { ApiClient, apiBaseUrl } from './client';
import { getServerAccessToken } from '../supabase/server';

/** Server-side API client bound to the current Supabase session. */
export async function createServerApiClient(): Promise<ApiClient | null> {
  const token = await getServerAccessToken();
  if (!token) return null;
  return new ApiClient({
    baseUrl: apiBaseUrl(),
    getAccessToken: async () => token,
  });
}

export function tenantPath(tenantId: string, suffix: string): string {
  return `/tenants/${tenantId}${suffix}`;
}
