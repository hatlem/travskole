import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained build for Azure App Service (deployed via scripts/deploy-app.sh)
  output: 'standalone',
  // Force-include every Prisma query-engine (incl. the extra Linux binaryTargets)
  // in the standalone bundle. Next's file tracer otherwise only keeps the engine
  // it loads at build time, which would drop the other Linux engines.
  outputFileTracingIncludes: {
    '/**/*': [
      './node_modules/.prisma/client/*.node',
      './node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/*.node',
    ],
  },
  // Hold ikke-runtime-filer UTE av standalone-bundelen (de skal aldri på prod-
  // serveren). Spesielt deploy-artefakt, interne rapporter, skript og kilde-markdown.
  outputFileTracingExcludes: {
    '/**/*': [
      './deploy/**',
      './scripts/**',
      './tests/**',
      './docs/**',
      './sec-review*.md',
      './testit*.md',
      './README*.md',
      './*.zip',
    ],
  },
  async redirects() {
    return [
      {
        source: '/courses',
        destination: '/arrangementer',
        permanent: true,
      },
      {
        source: '/courses/:id',
        destination: '/arrangementer',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `
              default-src 'self';
              script-src 'self' 'unsafe-inline' 'unsafe-eval'
                https://www.googletagmanager.com
                https://www.google-analytics.com
                https://connect.facebook.net
                https://sc-static.net
                https://cdn.getcookies.co
                https://js.stripe.com
                https://checkout.vipps.no;
              style-src 'self' 'unsafe-inline';
              img-src 'self' data: https:;
              font-src 'self' data:;
              connect-src 'self'
                https://www.google-analytics.com
                https://www.facebook.com
                https://tr.snapchat.com
                https://api.getcookies.co
                https://api.stripe.com
                https://api.vipps.no;
              frame-src https://js.stripe.com https://checkout.vipps.no;
              object-src 'none';
              base-uri 'self';
              form-action 'self';
              frame-ancestors 'none';
            `.replace(/\s+/g, ' ').trim()
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ];
  }
};

export default nextConfig;
