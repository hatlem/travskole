import { PageHeader } from '@/components/admin/PageHeader';
import { ReplyList } from '@/components/admin/replies/ReplyList';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Svar' };

export default function SvarPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Svar"
        description="Svar fra dem som har fått e-post fra oss. Svar herfra, eller merk dem som «trenger ikke svar». De som må svares, ligger øverst. Har noen svart til din egen e-post? Videresend den til registrering@bjerke.no, så stopper e-postene til dem, og svaret dukker opp her."
      />
      <ReplyList showNextYear empty={<p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">Ingen har svart ennå.</p>} />
    </div>
  );
}
