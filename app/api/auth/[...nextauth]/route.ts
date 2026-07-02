import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth';
import { loginLimiter, checkRateLimit } from '@/lib/rate-limiter';
import { logFailedLogin } from '@/lib/logger';
import { MAGIC_LINK_PREFIX } from '@/app/api/auth/magic-link/route';

// Passordløs innlogging (magic link) er implementert som en egen credentials-
// provider, IKKE via NextAuths EmailProvider + PrismaAdapter. Adapteret sammen med
// CredentialsProvider + JWT-strategi ga tomme sesjoner, så vi holder oss til et rent
// JWT-oppsett og validerer engangs-tokenet selv (samme mønster som passord-reset).
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'magic-link',
      name: 'Magic Link',
      credentials: {
        email: { label: 'E-post', type: 'email' },
        token: { label: 'Token', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.token) {
          throw new Error('Ugyldig innloggingslenke');
        }

        const normalizedEmail = credentials.email.trim().toLowerCase();
        const identifier = MAGIC_LINK_PREFIX + normalizedEmail;
        // Tokens lagres som sha256-hash (se /api/auth/magic-link).
        const tokenHash = crypto.createHash('sha256').update(credentials.token).digest('hex');

        const vt = await prisma.verificationToken.findFirst({
          where: { identifier, token: tokenHash },
        });

        if (!vt || vt.expires < new Date()) {
          // Rydd bort et utløpt token så det ikke blir liggende.
          if (vt) {
            await prisma.verificationToken.deleteMany({ where: { identifier, token: tokenHash } });
          }
          throw new Error('Ugyldig eller utløpt innloggingslenke');
        }

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          include: { parent: true },
        });
        if (!user) {
          throw new Error('Ugyldig eller utløpt innloggingslenke');
        }

        // Engangsbruk: forbruk tokenet umiddelbart.
        await prisma.verificationToken.deleteMany({ where: { identifier, token: tokenHash } });

        // Magic link beviser kontroll over e-postadressen → marker som verifisert.
        if (!user.emailVerified) {
          await prisma.user
            .update({ where: { id: user.id }, data: { emailVerified: new Date() } })
            .catch(() => {});
        }

        return {
          id: user.id.toString(),
          email: user.email,
          role: user.role,
          name: user.parent?.name || null,
        };
      },
    }),
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

        const normalizedEmail = credentials.email.trim().toLowerCase();
        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
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
    signIn: '/login',
    signOut: '/signout',
    error: '/login',
    verifyRequest: '/verify-request',
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
