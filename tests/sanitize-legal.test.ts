import { describe, it, expect } from 'vitest';
import { sanitizeLegalHtml } from '@/lib/sanitize';

describe('sanitizeLegalHtml', () => {
  it('beholder target/rel og interne lenker', () => {
    const html = sanitizeLegalHtml('<p><a href="https://bjerke.no" target="_blank" rel="noopener noreferrer">x</a> <a href="/personvern">p</a> <a href="#a">a</a></p>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="/personvern"');
    expect(html).toContain('href="#a"');
  });

  it('fjerner javascript-lenker og skript', () => {
    const html = sanitizeLegalHtml('<a href="javascript:alert(1)">x</a><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });
});
