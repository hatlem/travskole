// Minimal nettleser-cookiejar for tester: modellerer host-only vs. Domain-cookies
// og sletting via Max-Age=0, slik document.cookie oppfører seg.

interface StoredCookie {
  name: string;
  value: string;
  domain: string | null;
}

export class FakeCookieJar {
  private cookies: StoredCookie[] = [];
  readonly writes: string[] = [];

  constructor(private readonly hostname: string) {}

  get cookie(): string {
    return this.cookies
      .filter((c) => !c.domain || this.hostname === c.domain.slice(1) || this.hostname.endsWith(c.domain))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  set cookie(raw: string) {
    this.writes.push(raw);
    const [pair, ...attrs] = raw.split(/;\s*/);
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    let domain: string | null = null;
    let maxAge: number | null = null;
    for (const attr of attrs) {
      const [k, v] = attr.split('=');
      if (k.toLowerCase() === 'domain') domain = v.startsWith('.') ? v.toLowerCase() : `.${v.toLowerCase()}`;
      if (k.toLowerCase() === 'max-age') maxAge = Number(v);
    }
    if (domain && !(this.hostname === domain.slice(1) || this.hostname.endsWith(domain))) return;
    this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain));
    if (maxAge !== null && maxAge <= 0) return;
    this.cookies.push({ name, value, domain });
  }

  seed(name: string, value: string, domain: string | null): void {
    this.cookies.push({ name, value, domain });
  }

  list(): StoredCookie[] {
    return [...this.cookies];
  }
}
