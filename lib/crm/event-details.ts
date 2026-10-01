// Én lesbar linje om hva en hendelse (AppEvent) gjaldt, laget fra meta-JSON-en.
// Interne id-er vises aldri; ukjent meta gir tom tekst (rådata ligger under «Teknisk»).

const BOOKING_STATUS: Record<string, string> = {
  new: 'Ny',
  pending: 'Venter',
  confirmed: 'Bekreftet',
  approved: 'Godkjent',
  rejected: 'Avslått',
  cancelled: 'Avlyst',
  withdrawn: 'Trukket',
  completed: 'Fullført',
};

const CONSENT_SOURCE: Record<string, string> = {
  import: 'fra import',
  avmelding: 'via avmeldingslenken',
  registration_form: 'i påmeldingsskjemaet',
  booking_form: 'i forespørselsskjemaet',
};

const LIST_SOURCE: Record<string, string> = {
  manual: 'for hånd',
  import: 'fra import',
};

function parse(meta: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!meta) return {};
  if (typeof meta === 'object') return meta;
  try {
    const parsed: unknown = JSON.parse(meta);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** «https://bjerke.no/kurs/ponni?utm=…» → «bjerke.no/kurs/ponni». */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.host.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}

const kr = (n: number) => `${Math.round(n).toLocaleString('nb-NO')} kr`;

/** Kort beskrivelse av detaljene for en hendelse, f.eks. «Liste: Julebord 2026» eller «/kurs/ponniskole». */
export function describeEventMeta(type: string, meta: string | Record<string, unknown> | null | undefined): string {
  const m = parse(meta);
  switch (type) {
    case 'page.viewed':
    case 'course.viewed':
    case 'signup.started': {
      const title = str(m.title);
      const path = str(m.path) ?? (str(m.url) ? shortUrl(m.url as string) : null) ?? str(m.courseSlug);
      if (title && path) return `${title} (${path})`;
      return title ?? path ?? '';
    }
    case 'cta.clicked': {
      const label = str(m.ctaId);
      const target = str(m.href) ? shortUrl(m.href as string) : null;
      return [label && `Knapp: ${label}`, target && `til ${target}`].filter(Boolean).join(' ');
    }
    case 'email.clicked':
      return str(m.url) ? `Lenke: ${shortUrl(m.url as string)}` : '';
    case 'email.bounced':
      return m.hard === true ? 'Adressen finnes ikke (permanent)' : m.hard === false ? 'Midlertidig feil hos mottakeren' : '';
    case 'list.member_added':
    case 'list.member_removed': {
      const name = str(m.listName);
      const source = str(m.source);
      const via = source ? LIST_SOURCE[source] : undefined;
      return [name && `Liste: ${name}`, via].filter(Boolean).join(', ');
    }
    case 'consent.updated': {
      const answer = m.marketing === true ? 'Ja til markedsføring' : m.marketing === false ? 'Nei til markedsføring' : '';
      const source = str(m.kilde);
      const via = source ? CONSENT_SOURCE[source] ?? source : '';
      return [answer, via].filter(Boolean).join(' ');
    }
    case 'registration.created':
    case 'registration.confirmed':
    case 'registration.cancelled':
      return str(m.courseName) ? `Kurs: ${m.courseName as string}` : '';
    case 'booking.created':
      return str(m.eventType) ? `Type: ${m.eventType as string}` : '';
    case 'booking.status_changed': {
      const status = str(m.status);
      return status ? `Ny status: ${BOOKING_STATUS[status] ?? status}` : '';
    }
    case 'payment.succeeded':
    case 'payment.failed':
    case 'payment.refunded':
    case 'payment.expired':
    case 'payment.partially_refunded': {
      const amount = num(m.amountKr) ?? num(m.amount);
      const parts = [amount !== null ? kr(amount) : null, m.reason === 'cancelled' ? 'avbrutt av kunden' : null];
      return parts.filter(Boolean).join(', ');
    }
    default:
      return '';
  }
}

const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];

/** «13. juli 2026 kl. 14:05» i norsk tid. */
export function formatEventTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${Number(get('day'))}. ${MONTHS[Number(get('month')) - 1]} ${get('year')} kl. ${get('hour')}:${get('minute')}`;
}
