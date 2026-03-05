import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { PrismaClient } from '@prisma/client';
import { verifyPassword } from '@/lib/auth';

const prisma = new PrismaClient();

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'E-post', type: 'email' },
        password: { label: 'Passord', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('E-post og passord er påkrevd');
        }

        // Find user by email
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { parent: true },
        });

        if (!user) {
          throw new Error('Feil e-post eller passord');
        }

        // Verify password
        const isValid = await verifyPassword(
          credentials.password,
          user.passwordHash
        );

        if (!isValid) {
          throw new Error('Feil e-post eller passord');
        }

        // Return user object (will be stored in JWT)
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
    error: '/auth/login',
  },

  callbacks: {
    async jwt({ token, user }) {
      // Add role and user ID to JWT token
      if (user) {
        token.role = user.role;
        token.id = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      // Add role and user ID to session object
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
