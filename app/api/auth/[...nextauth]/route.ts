import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import EmailProvider from 'next-auth/providers/email';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Adapter } from 'next-auth/adapters';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth';
import { loginLimiter, checkRateLimit } from '@/lib/rate-limiter';
import { logFailedLogin } from '@/lib/logger';

// Only include EmailProvider when email server is configured
const emailProvider = process.env.EMAIL_SERVER_HOST
  ? [
      EmailProvider({
        server: {
          host: process.env.EMAIL_SERVER_HOST,
          port: Number(process.env.EMAIL_SERVER_PORT || 587),
          auth: {
            user: process.env.EMAIL_SERVER_USER,
            pass: process.env.EMAIL_SERVER_PASSWORD,
          },
        },
        from: process.env.EMAIL_FROM || process.env.SMTP_FROM || 'registrering@bjerke.no',
      }),
    ]
  : [];

export const authOptions: NextAuthOptions = {
  // Only use adapter when email provider is configured (needed for verification tokens)
  // PrismaAdapter with CredentialsProvider + JWT strategy causes empty sessions
  ...(process.env.EMAIL_SERVER_HOST ? { adapter: PrismaAdapter(prisma) as Adapter } : {}),

  providers: [
    ...emailProvider,
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'E-post', type: 'email' },
        password: { label: 'Passord', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('E-post og passord er påkrevd');
        }

        // SECURITY: brute-force protection — 5 attempts per 15 min per IP+email
        const ip =
          (req?.headers?.['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
          'unknown';
        const rateLimit = await checkRateLimit(loginLimiter, `${ip}:${credentials.email.toLowerCase()}`);
        if (!rateLimit.allowed) {
          throw new Error(rateLimit.error || 'For mange innloggingsforsøk. Prøv igjen senere.');
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { parent: true },
        });

        if (!user || !user.passwordHash) {
          throw new Error('Feil e-post eller passord');
        }

        const isValid = await verifyPassword(
          credentials.password,
          user.passwordHash
        );

        if (!isValid) {
          logFailedLogin(credentials.email, ip);
          throw new Error('Feil e-post eller passord');
        }

        return {
          id: user.id.toString(),
          email: user.email,
          role: user.role,
          name: user.parent?.name || null,
        };
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  pages: {
    signIn: '/auth/login',
    signOut: '/auth/signout',
    error: '/auth/login',
    verifyRequest: '/auth/verify-request',
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in
        token.role = user.role;
        token.id = user.id;
        return token;
      }
      // Re-valider mot DB ved hver påfølgende forespørsel slik at rolleendringer,
      // degradering og kontosletting trer i kraft umiddelbart — ikke en opptil
      // 30 dager gammel JWT-snapshot. Forsvar mot stjålne/foreldede sesjoner.
      if (token.id != null) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: Number(token.id) },
            select: { role: true },
          });
          if (!dbUser) {
            // Bruker slettet → tom rolle (ikke admin/superadmin) = de-privilegert
            token.role = '';
            return token;
          }
          token.role = dbUser.role;
        } catch {
          // DB midlertidig utilgjengelig: behold token (fail-open for tilgjengelighet)
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
