/** Bare Exchange sitt eget stempel godtas som «intern avsender». */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { isAuthenticatedInternal } from '@/lib/tracking/poller';

describe('isAuthenticatedInternal', () => {
  it('AuthAs: Internal godtas; Authentication-Results (kan forfalskes) gjør det ikke', () => {
    expect(isAuthenticatedInternal([{ name: 'X-MS-Exchange-Organization-AuthAs', value: 'Internal' }], 'bjerke.no')).toBe(true);
    expect(isAuthenticatedInternal([{ name: 'X-MS-Exchange-Organization-AuthAs', value: 'Anonymous' }], 'bjerke.no')).toBe(false);
    expect(isAuthenticatedInternal([{ name: 'Authentication-Results', value: 'dmarc=pass header.from=bjerke.no' }], 'bjerke.no')).toBe(false);
    expect(isAuthenticatedInternal([], 'bjerke.no')).toBe(false);
  });
});
