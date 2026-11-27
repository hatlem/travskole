import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getUtsendelse } from '@/lib/utsendelser/config';
import { countOpenReplies, listReplies, type ReplyFilter } from '@/lib/replies/list';
import { nextYearSummary } from '@/lib/replies/neste-aar';
import { getThanksSettings, thanksQueue } from '@/lib/replies/thanks';
import { isClassifierEnabled } from '@/lib/replies/classify';
import { getStandardReplies } from '@/lib/replies/standard';

/** Svar fra kontakter: alle, for én kontakt, eller for én utsendelse. `?antall=1` gir bare hvor mange som må svares. */
export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  if (sp.get('antall') === '1') return NextResponse.json({ open: await countOpenReplies() });

  const status = sp.get('status');
  const filter: ReplyFilter = { status: status === 'open' || status === 'handled' ? status : 'all' };
  const kontakt = Number(sp.get('kontakt'));
  if (sp.has('kontakt')) {
    if (!Number.isInteger(kontakt) || kontakt <= 0) return NextResponse.json({ error: 'Ugyldig kontakt' }, { status: 400 });
    filter.contactId = kontakt;
  }
  const utsendelseId = sp.get('utsendelse');
  if (utsendelseId) {
    const utsendelse = await getUtsendelse(utsendelseId);
    if (!utsendelse) return NextResponse.json({ error: 'Fant ikke utsendelsen.' }, { status: 404 });
    filter.flowIds = utsendelse.flyter.map((f) => f.flowId);
  }
  const [replies, open, nesteAar, thanksSettings, queue, standard] = await Promise.all([
    listReplies(filter), countOpenReplies(), nextYearSummary(), getThanksSettings(), thanksQueue(), getStandardReplies(),
  ]);
  return NextResponse.json({ replies, open, nesteAar, standard, takk: { ...thanksSettings, venter: queue.length, aiEnabled: isClassifierEnabled() } });
}
