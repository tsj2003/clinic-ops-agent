import { NextResponse } from 'next/server';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const GUARDED_PATHS = ['/api/runs', '/api/workspaces', '/api/discover-sources'];

function shouldGuard(request) {
  if (!WRITE_METHODS.has(request.method)) {
    return false;
  }

  const pathname = request.nextUrl.pathname;
  return GUARDED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function middleware(request) {
  if (!shouldGuard(request)) {
    return NextResponse.next();
  }

  const expectedKey = String(process.env.INTERNAL_API_KEY || '').trim();
  if (!expectedKey) {
    return NextResponse.next();
  }

  const providedKey = String(request.headers.get('x-internal-api-key') || '').trim();
  if (!providedKey || providedKey !== expectedKey) {
    return NextResponse.json(
      {
        error: 'Unauthorized request. Missing or invalid internal API key.',
        code: 'unauthorized',
      },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
