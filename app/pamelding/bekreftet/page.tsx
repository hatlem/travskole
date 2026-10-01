import type { Metadata } from 'next';
import { ConfirmationView } from './confirmation-view';

export const metadata: Metadata = {
  title: 'Bekreftelse',
  description: 'Bekreftelse på påmelding eller forespørsel',
  robots: { index: false },
};

export default function BekreftetPage() {
  return <ConfirmationView />;
}
