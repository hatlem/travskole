/**
 * Client IP resolution for apps served by Azure App Service, optionally behind Cloudflare.
 * Azure variant of the portfolio helper (the Railway variant trusts the leftmost
 * X-Forwarded-For entry, which is client-controlled here).
 *
 * Trust model (Azure App Service front end, per Microsoft's App Service docs):
 * - The front end sets X-Client-IP (and Client-IP, which carries a port) to the TCP peer it
 *   accepted the connection from, overwriting any client-sent value, so it cannot be spoofed.
 * - X-Forwarded-For is APPENDED to: a client-sent value is kept on the left and the front end
 *   adds "<peer>:<port>" on the right. The leftmost entry is therefore client-controlled; only
 *   the rightmost entry is the front end's own, and it is used only when X-Client-IP is absent.
 * - cf-connecting-ip, true-client-ip, x-real-ip and Forwarded pass through untouched. They are
 *   never read, except cf-connecting-ip when the peer is in Cloudflare's published ranges and the
 *   request is not a Worker subrequest (Cloudflare always stamps those with CF-Worker).
 */

import { CLOUDFLARE_IPV4_RANGES, CLOUDFLARE_IPV6_RANGES } from './cloudflare-ranges'

export type HeaderBag =
  | { get(name: string): string | null | undefined }
  | Readonly<Record<string, string | readonly string[] | undefined>>

export type ClientIpSource = 'cloudflare' | 'peer' | 'unknown'

export interface ResolvedClientIp {
  ip: string
  source: ClientIpSource
}

export const UNKNOWN_CLIENT_IP = 'unknown'

interface ParsedIp {
  version: 4 | 6
  bytes: readonly number[]
}

interface Cidr extends ParsedIp {
  prefix: number
}

const IPV4_PATTERN = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/
const HEX_GROUP = /^[0-9a-f]{1,4}$/

function parseIpv4(value: string): number[] | null {
  const match = IPV4_PATTERN.exec(value)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

function parseIpv6(value: string): number[] | null {
  let text = value.toLowerCase()
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1)
  if (text.includes('%')) return null

  let tail: number[] = []
  const lastColon = text.lastIndexOf(':')
  if (text.includes('.', lastColon)) {
    const v4 = parseIpv4(text.slice(lastColon + 1))
    if (!v4) return null
    tail = v4
    text = text.slice(0, lastColon + 1) + '0:0'
  }

  const halves = text.split('::')
  if (halves.length > 2) return null

  const toGroups = (part: string): number[] | null => {
    if (part === '') return []
    const groups = part.split(':')
    if (!groups.every((group) => HEX_GROUP.test(group))) return null
    return groups.map((group) => parseInt(group, 16))
  }

  const [first = '', second] = halves
  const head = toGroups(first)
  const rest = second === undefined ? [] : toGroups(second)
  if (!head || !rest) return null

  let groups: number[]
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length
    if (missing < 1) return null
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null

  const bytes = groups.flatMap((group) => [group >> 8, group & 0xff])
  if (tail.length === 4) bytes.splice(12, 4, ...tail)
  return bytes
}

function isV4Mapped(bytes: readonly number[]): boolean {
  return bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff
}

function parseIp(raw: string | undefined): ParsedIp | null {
  if (!raw) return null
  const value = raw.trim()
  if (value.length === 0 || value.length > 64) return null

  if (!value.includes(':')) {
    const v4 = parseIpv4(value)
    return v4 ? { version: 4, bytes: v4 } : null
  }

  const v6 = parseIpv6(value)
  if (!v6) return null
  return isV4Mapped(v6) ? { version: 4, bytes: v6.slice(12) } : { version: 6, bytes: v6 }
}

function formatIp({ version, bytes }: ParsedIp): string {
  if (version === 4) return bytes.join('.')

  const groups = Array.from({ length: 8 }, (_, i) => ((bytes[i * 2] ?? 0) << 8) | (bytes[i * 2 + 1] ?? 0))
  let bestStart = -1
  let bestLength = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLength) {
      bestStart = i
      bestLength = j - i
    }
    i = j
  }

  const hex = groups.map((group) => group.toString(16))
  if (bestLength < 2) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`
}

function parseCidr(cidr: string): Cidr {
  const [address, prefixText] = cidr.split('/')
  const parsed = parseIp(address)
  const prefix = Number(prefixText)
  const maxPrefix = parsed?.version === 4 ? 32 : 128
  if (!parsed || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    throw new Error(`Invalid CIDR in Cloudflare ranges: ${cidr}`)
  }
  return { ...parsed, prefix }
}

function cidrContains(cidr: Cidr, ip: ParsedIp): boolean {
  if (cidr.version !== ip.version) return false
  const fullBytes = Math.floor(cidr.prefix / 8)
  for (let i = 0; i < fullBytes; i++) {
    if (cidr.bytes[i] !== ip.bytes[i]) return false
  }
  const remainingBits = cidr.prefix % 8
  if (remainingBits === 0) return true
  const mask = (0xff << (8 - remainingBits)) & 0xff
  return ((cidr.bytes[fullBytes] ?? 0) & mask) === ((ip.bytes[fullBytes] ?? 0) & mask)
}

const CLOUDFLARE_RANGES: readonly Cidr[] = [...CLOUDFLARE_IPV4_RANGES, ...CLOUDFLARE_IPV6_RANGES].map(parseCidr)

function isCloudflarePeer(ip: ParsedIp): boolean {
  return CLOUDFLARE_RANGES.some((range) => cidrContains(range, ip))
}

function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(name: string): string | null | undefined }).get(name) ?? undefined
  }

  const record = headers as Readonly<Record<string, string | readonly string[] | undefined>>
  let value = record[name]
  if (value === undefined) {
    const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name)
    value = key === undefined ? undefined : record[key]
  }
  if (Array.isArray(value)) return value.join(',')
  return value as string | undefined
}

/** "1.2.3.4", "1.2.3.4:5678", "[2001:db8::1]:5678" or a bare IPv6 address. */
function parseHostPort(raw: string | undefined): ParsedIp | null {
  if (!raw) return null
  const value = raw.trim()
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value)
  if (bracketed) return parseIp(bracketed[1])
  const v4WithPort = /^([0-9.]+):\d{1,5}$/.exec(value)
  if (v4WithPort) return parseIp(v4WithPort[1])
  return parseIp(value)
}

function frontEndPeer(headers: HeaderBag): ParsedIp | null {
  const clientIp = parseHostPort(readHeader(headers, 'x-client-ip'))
  if (clientIp) return clientIp
  const forwardedFor = readHeader(headers, 'x-forwarded-for')
  const hops = forwardedFor?.split(',') ?? []
  return parseHostPort(hops[hops.length - 1])
}

export function resolveClientIp(headers: HeaderBag): ResolvedClientIp {
  const peer = frontEndPeer(headers)
  if (!peer) return { ip: UNKNOWN_CLIENT_IP, source: 'unknown' }

  if (isCloudflarePeer(peer) && !readHeader(headers, 'cf-worker')) {
    const visitor = parseIp(readHeader(headers, 'cf-connecting-ip'))
    if (visitor) return { ip: formatIp(visitor), source: 'cloudflare' }
  }

  return { ip: formatIp(peer), source: 'peer' }
}

export function getClientIp(headers: HeaderBag): string {
  return resolveClientIp(headers).ip
}

export function toRateLimitBucket(ip: string): string {
  const parsed = parseIp(ip)
  if (!parsed) return UNKNOWN_CLIENT_IP
  if (parsed.version === 4) return formatIp(parsed)
  const network = [...parsed.bytes.slice(0, 8), 0, 0, 0, 0, 0, 0, 0, 0]
  return `${formatIp({ version: 6, bytes: network })}/64`
}

export function getClientIpBucket(headers: HeaderBag): string {
  return toRateLimitBucket(getClientIp(headers))
}

export function isCloudflareIp(ip: string): boolean {
  const parsed = parseIp(ip)
  return parsed !== null && isCloudflarePeer(parsed)
}

export function normalizeIp(ip: string): string | null {
  const parsed = parseIp(ip)
  return parsed ? formatIp(parsed) : null
}
