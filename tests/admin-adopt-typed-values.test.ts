/** Nytt kurs: tekst skrevet før siden var ferdig lastet skal ikke forsvinne. */
import { describe, it, expect, vi } from 'vitest';
import { adoptTypedValues } from '@/components/admin/useAdoptTypedValues';

describe('adoptTypedValues', () => {
  it('overfører skrevne verdier til state og lar tomme felt være', () => {
    const setName = vi.fn();
    const setSlug = vi.fn();
    const setPrice = vi.fn();
    const dom: Record<string, string | null> = { name: 'Ponniskole høst', slug: '', price: null };
    adoptTypedValues((n) => dom[n] ?? null, { name: setName, slug: setSlug, price: setPrice });
    expect(setName).toHaveBeenCalledWith('Ponniskole høst');
    expect(setSlug).not.toHaveBeenCalled();
    expect(setPrice).not.toHaveBeenCalled();
  });
});
