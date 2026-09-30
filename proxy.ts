import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { findCourseBySlug, parseCoursePath } from '@/lib/course-lookup';

/**
 * Ukjente kurs-URL-er får ekte 404. Siden selv kan ikke sette statusen:
 * loading.tsx gjør at svaret strømmes (200) før notFound() kalles. DB-feil
 * slipper forespørselen videre til siden.
 */
async function isMissingCourse(pathname: string): Promise<boolean> {
  const parsed = parseCoursePath(pathname);
  if (!parsed) return false;
  try {
    return (await findCourseBySlug(parsed.type, parsed.slug)) === null;
  } catch {
    return false;
  }
}

export default withAuth(
  async function middleware(req) {
    // SECURITY: Enforce HTTPS in production
    if (
      process.env.NODE_ENV === 'production' &&
      req.headers.get('x-forwarded-proto') !== 'https'
    ) {
      return NextResponse.redirect(
        `https://${req.headers.get('host')}${req.nextUrl.pathname}${req.nextUrl.search}`,
        301
      );
    }

    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    if (pathname.startsWith('/arrangementer/') && (await isMissingCourse(pathname))) {
      // Omskriving til en sti uten rute gir Next sin not-found-side med status 404.
      return NextResponse.rewrite(new URL('/arrangementer-ikke-funnet', req.url));
    }

    // Admin routes require admin role
    if (pathname.startsWith('/admin') && token?.role !== 'admin' && token?.role !== 'superadmin') {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;

        // Require authentication for protected routes. Deaktiverte/anonymiserte
        // kontoer (token.deactivated) låses ute selv om sesjonen ellers er gyldig.
        if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin')) {
          return !!token && !token.deactivated;
        }

        // All other matched routes are public
        return true;
      },
    },
    pages: {
      signIn: '/login',
    },
  }
);

export const config = {
  // Beskyttede ruter + kurssider (404-sjekk)
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/arrangementer/:type/:year/:slug',
    '/arrangementer/:type/:year/:slug/pamelding',
  ],
};
