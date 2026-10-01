import { describe, it, expect } from 'vitest';
import { formatActivity } from '@/lib/activity-format';

const enroll = (action: string, summary: Record<string, number>) =>
  formatActivity({ action, entity: 'flow', entityId: 3, details: JSON.stringify(summary) });

describe('formatActivity', () => {
  it('describes list/segment/contact enrollments as sentences with people counts', () => {
    const list = enroll('enroll_list', { enrolled: 4, skippedActive: 2, skippedSuppressed: 0, skippedMissing: 0, capped: 0 });
    expect(list.summary).toBe('La til en liste i e-postflyt (4 personer)');
    expect(list.details).toBe('Allerede med: 2');
    expect(enroll('enroll_segment', { enrolled: 1 }).summary).toBe('La til et segment i e-postflyt (1 person)');
    expect(enroll('enroll', { enrolled: 0 }).summary).toBe('La til personer i e-postflyt (0 personer)');
  });

  it('turns a send-window change into «Endret sendetider» without raw keys', () => {
    const r = formatActivity({ action: 'update', entity: 'flow', details: JSON.stringify({ sendWindow: 'custom', wokenEnrollments: 0 }) });
    expect(r).toEqual({ summary: 'Endret sendetider', details: '' });
    const woken = formatActivity({ action: 'update', entity: 'flow', details: JSON.stringify({ sendWindow: 'anytime', wokenEnrollments: 3 }) });
    expect(woken.summary).toBe('Endret sendetider (3 personer får e-posten tidligere)');
  });

  it('describes archiving with the number of people taken out', () => {
    const r = formatActivity({ action: 'update', entity: 'flow', details: JSON.stringify({ status: 'archived', exitedEnrollments: 5 }) });
    expect(r.summary).toBe('Arkiverte e-postflyten (5 personer tatt ut)');
  });

  it('hides internal ids such as nodeId and contactId', () => {
    const r = formatActivity({
      action: 'flow_test_send', entity: 'flow',
      details: JSON.stringify({ nodeId: 12, toEmail: 'kari@bjerke.no', contactId: null, aiPersonalized: false }),
    });
    expect(r.summary).toBe('Sendte test-e-post til kari@bjerke.no');
    expect(r.details).toBe('');
    const ai = formatActivity({ action: 'flow_test_send', entity: 'flow', details: JSON.stringify({ nodeId: 1, toEmail: 'a@b.no', aiPersonalized: true }) });
    expect(ai.summary).toBe('Sendte test-e-post til a@b.no (KI-tilpasset)');
  });

  it('formats status changes, exports and imports', () => {
    expect(formatActivity({
      action: 'status_change', entity: 'registration', details: JSON.stringify({ from: 'pending', to: 'cancelled', selfService: true }),
    }).summary).toBe('Endret status på påmeldingen: Venter → Avlyst (gjort av kunden selv)');
    expect(formatActivity({ action: 'export', entity: 'registration', details: JSON.stringify({ rows: 12 }) }).summary)
      .toBe('Eksporterte påmeldinger (12 rader)');
    const imp = formatActivity({
      action: 'create', entity: 'contact_import',
      details: JSON.stringify({ fileName: 'kunder.csv', created: 3, updated: 1, unchanged: 0, skipped: 0, failed: 0, listId: 9 }),
    });
    expect(imp.summary).toBe('Importerte kontakter fra «kunder.csv»');
    expect(imp.details).toBe('Nye: 3 · Oppdatert: 1');
  });

  it('falls back to «action + noun» and keeps free-text details', () => {
    expect(formatActivity({ action: 'create', entity: 'contact' })).toEqual({ summary: 'Opprettet kontakt', details: '' });
    expect(formatActivity({ action: 'update', entity: 'course', details: 'Ponnikurs høst' }))
      .toEqual({ summary: 'Oppdatert kurs', details: 'Ponnikurs høst' });
    expect(formatActivity({ action: 'update', entity: 'flow_graph' }).summary).toBe('Endret stegene i e-postflyten');
  });

  it('passes unknown codes through without crashing', () => {
    const r = formatActivity({ action: 'mystery', entity: 'thing', details: JSON.stringify({ foo: 'bar', nodeId: 1 }) });
    expect(r.summary).toBe('mystery – thing');
    expect(r.details).toBe('foo: bar');
  });
});

describe('aktivering med personer i kø', () => {
  it('nevner hvor mange som startet', () => {
    expect(
      formatActivity({ action: 'activate', entity: 'flow', details: JSON.stringify({ startedEnrollments: 4 }) }),
    ).toEqual({ summary: 'Aktiverte e-postflyten (4 personer som ventet, startet)', details: '' });
  });
});
