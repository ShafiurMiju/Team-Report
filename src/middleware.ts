import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const pathname = decodeURIComponent(request.nextUrl.pathname).toLowerCase();

  // Block common malicious scanner paths early
  const suspiciousPathPattern =
    /\.env|\.git|\.ssh|authorized_keys|laravel\.log|database_dump|\.sql|\.bak|config\/|backup\//;
  if (suspiciousPathPattern.test(pathname)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const isStaticAsset =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    /\.[a-z0-9]+$/i.test(pathname);
  if (isStaticAsset || pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request });
  const isAuthPage = request.nextUrl.pathname === '/login';
  const isPublicPage = request.nextUrl.pathname === '/';
  const isProtectedPage =
    request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/projects') ||
    request.nextUrl.pathname.startsWith('/my-projects') ||
    request.nextUrl.pathname.startsWith('/tasks') ||
    request.nextUrl.pathname.startsWith('/team') ||
    request.nextUrl.pathname.startsWith('/reports') ||
    request.nextUrl.pathname.startsWith('/settings');

  if (isAuthPage) {
    if (token) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  if (isPublicPage) {
    if (token) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isProtectedPage && !token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/:path*'],
};
