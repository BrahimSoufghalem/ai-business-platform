export const STORE_COOKIE = 'ab_store_id';

export function readStoreCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}
