import bcrypt from 'bcryptjs';
import { getServerSession as getNextAuthServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * Hash a plain text password using bcrypt
 * @param password - Plain text password
 * @returns Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

/**
 * Verify a plain text password against a hashed password
 * @param password - Plain text password
 * @param hashedPassword - Hashed password from database
 * @returns True if password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

/**
 * Get the current session server-side
 * Wrapper around NextAuth's getServerSession with our auth options
 */
export async function getServerSession() {
  return getNextAuthServerSession(authOptions);
}
