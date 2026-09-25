import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import { routing, localeDirection, type Locale } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

const PUBLIC_SEGMENTS = new Set([
  'login',
  'signup',
  'forgot-password',
  'reset-password',
  'confirm-email',
  'auth-error',
  'auth',
]);

function parsePath(pathname: string): { locale: Locale; segments: string[] } {
  const parts = pathname.split('/').filter(Boolean);
  const maybeLocale = parts[0] as Locale | undefined;
  if (maybeLocale && (routing.locales as readonly string[]).includes(maybeLocale)) {
    return { locale: maybeLocale, segments: parts.slice(1) };
  }
  return { locale: routing.defaultLocale, segments: parts };
}

export default async function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { locale, segments } = parsePath(request.nextUrl.pathname);
  const first = segments[0] ?? '';
  const isPublic = PUBLIC_SEGMENTS.has(first) || segments.length === 0;
  const dir = localeDirection[locale];

  if (!user && !isPublic) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== `/${locale}` && next !== `/${locale}/`) loginUrl.searchParams.set('next', next);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (first === 'login' || first === 'signup')) {
    return NextResponse.redirect(new URL(`/${locale}/overview`, request.url));
  }

  response.headers.set('x-text-direction', dir);
  return response;
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)'],
};
