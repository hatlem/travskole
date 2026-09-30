import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { postLoginDestination } from '@/lib/auth-redirect';
import LoginForm from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  // Deaktiverte kontoer får tom rolle i JWT-en (se jwt-callbacken) — de skal
  // bli her, ellers sender /dashboard dem i ring tilbake til /login.
  if (session?.user?.role) {
    const { callbackUrl } = await searchParams;
    redirect(postLoginDestination(typeof callbackUrl === 'string' ? callbackUrl : null, session.user.role));
  }

  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
