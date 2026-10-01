import { describe, expect, it } from 'vitest';
import { deleteFlowMessage, formatNorwegianDate, groupFlows } from '@/lib/crm/flow-list';

const flow = (status: string, name = status, activeEnrollments = 0) => ({ status, name, activeEnrollments });

describe('groupFlows', () => {
  it('skiller arbeidsflyter, arkiverte og maler og beholder rekkefølgen', () => {
    const groups = groupFlows([
      flow('active', 'a'),
      flow('archived', 'b'),
      flow('template', 'c'),
      flow('draft', 'd'),
      flow('paused', 'e'),
      flow('archived', 'f'),
    ]);
    expect(groups.current.map((f) => f.name)).toEqual(['a', 'd', 'e']);
    expect(groups.archived.map((f) => f.name)).toEqual(['b', 'f']);
    expect(groups.templates.map((f) => f.name)).toEqual(['c']);
  });

  it('gir tomme grupper for tom liste', () => {
    expect(groupFlows([])).toEqual({ current: [], archived: [], templates: [] });
  });
});

describe('formatNorwegianDate', () => {
  const now = new Date(2026, 9, 1);

  it('utelater årstallet i inneværende år', () => {
    expect(formatNorwegianDate(new Date(2026, 6, 13), now)).toBe('13. juli');
  });

  it('tar med årstallet for andre år', () => {
    expect(formatNorwegianDate(new Date(2025, 11, 1), now)).toBe('1. desember 2025');
  });

  it('godtar ISO-strenger', () => {
    expect(formatNorwegianDate(new Date(2026, 0, 5, 12).toISOString(), now)).toBe('5. januar');
  });

  it('gir tom streng for ugyldig dato', () => {
    expect(formatNorwegianDate('ikke en dato', now)).toBe('');
  });
});

describe('deleteFlowMessage', () => {
  it('nevner folk underveis i en pauset flyt', () => {
    expect(deleteFlowMessage(flow('paused', 'Velkommen', 3))).toBe(
      '«Velkommen» slettes for godt, med alle stegene og startreglene. 3 personer er underveis og får ikke resten av e-postene. Dette kan ikke angres.',
    );
  });

  it('bruker entall for én person', () => {
    expect(deleteFlowMessage(flow('paused', 'X', 1))).toContain('1 person er underveis');
  });

  it('nevner ingen underveis for maler eller tomme flyter', () => {
    expect(deleteFlowMessage(flow('template', 'Mal', 5))).not.toContain('underveis');
    expect(deleteFlowMessage(flow('draft', 'Utkast'))).toBe(
      '«Utkast» slettes for godt, med alle stegene og startreglene. Dette kan ikke angres.',
    );
  });
});
