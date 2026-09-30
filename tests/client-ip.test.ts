import { describe, expect, it } from 'vitest'

import { CLOUDFLARE_IPV4_RANGES, CLOUDFLARE_IPV6_RANGES } from '@/lib/client-ip/cloudflare-ranges'
import {
  UNKNOWN_CLIENT_IP,
  getClientIp,
  getClientIpBucket,
  isCloudflareIp,
  normalizeIp,
  resolveClientIp,
  toRateLimitBucket,
} from '@/lib/client-ip'

const CF_PEER = '172.64.209.36'
const CF_PEER_V6 = '2606:4700:10::6816:1'

/** What the App Service front end forwards for a TCP peer, plus whatever the client sent. */
const azure = (peer: string, extra: Record<string, string> = {}, clientXff?: string) => {
  const hop = peer.includes(':') ? `[${peer}]:51234` : `${peer}:51234`
  return new Headers({
    'x-forwarded-for': clientXff ? `${clientXff}, ${hop}` : hop,
    'x-client-ip': peer,
    'client-ip': hop,
    ...extra,
  })
}

describe('resolveClientIp — direct to App Service (not proxied by Cloudflare)', () => {
  it('uses X-Client-IP, which the front end overwrites', () => {
    expect(resolveClientIp(azure('46.227.157.237'))).toEqual({ ip: '46.227.157.237', source: 'peer' })
  })

  it('ignores a client-prepended X-Forwarded-For entry', () => {
    expect(getClientIp(azure('46.227.157.237', {}, '7.7.7.7'))).toBe('46.227.157.237')
  })

  it('ignores a forged cf-connecting-ip from a non-Cloudflare peer', () => {
    expect(getClientIp(azure('46.227.157.237', { 'cf-connecting-ip': '7.7.7.7' }))).toBe('46.227.157.237')
  })

  it('never reads x-real-ip, true-client-ip or Forwarded', () => {
    const headers = azure('46.227.157.237', {
      'x-real-ip': '1.2.3.4',
      'true-client-ip': '4.4.4.4',
      forwarded: 'for=6.6.6.6',
    })
    expect(getClientIp(headers)).toBe('46.227.157.237')
  })

  it('falls back to the rightmost X-Forwarded-For hop (the front end’s own) without X-Client-IP', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '7.7.7.7, 203.0.113.9:40000' }))).toBe('203.0.113.9')
    expect(getClientIp(new Headers({ 'x-forwarded-for': '7.7.7.7, [2001:db8::9]:40000' }))).toBe('2001:db8::9')
  })

  it('keys distinct visitors into distinct buckets', () => {
    expect(getClientIp(azure('203.0.113.9'))).not.toBe(getClientIp(azure('198.51.100.7')))
  })
})

describe('resolveClientIp — through Cloudflare', () => {
  it('trusts cf-connecting-ip when the peer is a Cloudflare IPv4 address', () => {
    expect(resolveClientIp(azure(CF_PEER, { 'cf-connecting-ip': '203.0.113.50' }))).toEqual({
      ip: '203.0.113.50',
      source: 'cloudflare',
    })
  })

  it('trusts cf-connecting-ip when the peer is a Cloudflare IPv6 address', () => {
    expect(resolveClientIp(azure(CF_PEER_V6, { 'cf-connecting-ip': '2001:db8::5' }))).toEqual({
      ip: '2001:db8::5',
      source: 'cloudflare',
    })
  })

  it('refuses cf-connecting-ip on Cloudflare Worker subrequests', () => {
    const headers = azure(CF_PEER, { 'cf-connecting-ip': '7.7.7.7', 'cf-worker': 'attacker.workers.dev' })
    expect(resolveClientIp(headers)).toEqual({ ip: CF_PEER, source: 'peer' })
  })

  it('falls back to the peer when cf-connecting-ip is missing or malformed', () => {
    expect(getClientIp(azure(CF_PEER))).toBe(CF_PEER)
    expect(getClientIp(azure(CF_PEER, { 'cf-connecting-ip': 'not-an-ip' }))).toBe(CF_PEER)
    expect(getClientIp(azure(CF_PEER, { 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' }))).toBe(CF_PEER)
  })
})

describe('resolveClientIp — malformed and missing input', () => {
  it('returns unknown without front-end headers (local dev)', () => {
    expect(resolveClientIp(new Headers())).toEqual({ ip: UNKNOWN_CLIENT_IP, source: 'unknown' })
    expect(getClientIp(new Headers({ 'x-real-ip': '1.2.3.4', 'cf-connecting-ip': '7.7.7.7' }))).toBe(UNKNOWN_CLIENT_IP)
  })

  it.each([
    ['garbage', 'not-an-ip'],
    ['octal-looking octet', '01.2.3.4'],
    ['out of range octet', '256.1.1.1'],
    ['port out of range', '1.2.3.4:123456'],
    ['double compression', '1::2::3'],
    ['zone id', 'fe80::1%eth0'],
    ['overlong', '1'.repeat(80)],
  ])('treats an X-Client-IP that is %s as unknown when no X-Forwarded-For exists', (_, value) => {
    expect(getClientIp(new Headers({ 'x-client-ip': value }))).toBe(UNKNOWN_CLIENT_IP)
  })

  it('never throws', () => {
    for (const value of ['', ',', ' , ', '::', ':::', '[]', '[::1', '1.2.3', '1.2.3.4.5', 'ffff::g', '[1.2.3.4]:x']) {
      expect(() => getClientIp(new Headers({ 'x-forwarded-for': value, 'x-client-ip': value }))).not.toThrow()
    }
  })
})

describe('header containers', () => {
  it('accepts Node IncomingHttpHeaders-style records (next-auth authorize req)', () => {
    expect(getClientIp({ 'x-client-ip': '203.0.113.9', 'x-forwarded-for': '7.7.7.7, 203.0.113.9:1' })).toBe(
      '203.0.113.9'
    )
  })

  it('matches header names case-insensitively in plain records', () => {
    expect(getClientIp({ 'X-Client-IP': '203.0.113.9' })).toBe('203.0.113.9')
  })
})

describe('shared helpers (identical to the Railway variant)', () => {
  it('recognises every vendored Cloudflare range', () => {
    for (const cidr of [...CLOUDFLARE_IPV4_RANGES, ...CLOUDFLARE_IPV6_RANGES]) {
      expect(isCloudflareIp(cidr.split('/')[0] ?? '')).toBe(true)
    }
    expect(isCloudflareIp('8.8.8.8')).toBe(false)
  })

  it('normalizes addresses', () => {
    expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(normalizeIp('2001:DB8:0:0:0:0:0:1')).toBe('2001:db8::1')
  })

  it('collapses IPv6 to /64 buckets and keeps IPv4 individual', () => {
    expect(toRateLimitBucket('203.0.113.9')).toBe('203.0.113.9')
    expect(toRateLimitBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64')
    expect(getClientIpBucket(azure('2001:db8:1:2::77'))).toBe('2001:db8:1:2::/64')
  })
})
