import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { isAdmin } from '@/lib/settings';
import { AdminShell } from './AdminShell';

export const metadata = {
  title: 'Admin',
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session || !isAdmin(session.user.role)) {
    redirect('/dashboard');
  }

  return (
    <AdminShell email={session.user.email ?? ''} role={session.user.role}>
      {children}
    </AdminShell>
  );
}
