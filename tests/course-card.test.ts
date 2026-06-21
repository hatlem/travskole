import { describe, it, expect } from 'vitest';
import { toCourseCardProps, compareForListing } from '@/lib/course-card';
import type { Course } from '@prisma/client';

const base = {
  id: 1, name: 'Test', slug: 'test', description: null, type: 'kurs',
  audience: 'barn', startDate: new Date('2026-08-01'), endDate: null,
  ageMin: null, ageMax: null, price: null, maxParticipants: null,
  status: 'open', imageUrl: null, registrationMode: 'standard',
  createdAt: new Date('2026-06-01'),
};

describe('toCourseCardProps', () => {
  it('maps dated standard course', () => {
    const p = toCourseCardProps(base as never);
    expect(p.id).toBe('1');
    expect(p.start_date).toBe('2026-08-01');
    expect(p.audience).toBe('barn');
    expect(p.registration_mode).toBe('standard');
    expect(p.year).toBe(2026);
  });
  it('handles null startDate (request arrangement)', () => {
    const p = toCourseCardProps({ ...base, startDate: null, registrationMode: 'request' } as never);
    expect(p.start_date).toBeUndefined();
    expect(p.registration_mode).toBe('request');
    expect(p.year).toBe(2026);
  });
});

describe('compareForListing', () => {
  it('dated before undated, dated ascending by date, undated by createdAt', () => {
    const datedEarly = { ...base, id: 1, startDate: new Date('2026-08-01') };
    const datedLate = { ...base, id: 2, startDate: new Date('2026-09-01') };
    const undated = { ...base, id: 3, startDate: null, createdAt: new Date('2026-06-02') };
    const sorted = ([undated, datedLate, datedEarly] as unknown as Course[])
      .sort(compareForListing)
      .map((c) => c.id);
    expect(sorted).toEqual([1, 2, 3]);
  });
});
