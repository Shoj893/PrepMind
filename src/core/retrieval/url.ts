import { isIP } from "node:net";
import dns from "node:dns/promises";

/**
 * URL validation and SSRF guarding.
 *
 * Every URL we fetch passes through here first. In production (default) we
 * reject anything that is not a public http(s) address: non-http schemes,
 * embedded credentials, unusual ports, literal private/loopback IPs and
 * hostnames that resolve to them. The connect-time check in fetcher.ts uses
 * the same classifier so DNS cannot be swapped between validation and
 * connection (DNS rebinding).
 *
 * Set ALLOW_PRIVATE_HOSTS=1 only in development/tests to crawl local
 * fixture sites.
 */

export class UrlRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlRejectedError";
  }
}

export function guardEnabled(): boolean {
  return process.env.ALLOW_PRIVATE_HOSTS !== "1";
}

const ALLOWED_PORTS = new Set(["", "80", "443", null]);

/** Non-routable / reserved suffixes treated as local even with a dot in them. */
const RESERVED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".corp",
  ".home",
  ".lan",
  ".invalid",
  ".test",
];

/** True for loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true; // not an IP at all — treat as untrusted
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb"))
    return true; // fe80::/10 link-local
  if (lower.startsWith("ff")) return true; // multicast
  // IPv4-mapped ::ffff:a.b.c.d — check the embedded IPv4
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/**
 * Validate a URL string for fetching. Throws UrlRejectedError when the URL
 * should not be fetched. Returns the normalised URL.
 */
export function assertFetchableUrl(raw: string, base?: string): URL {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new UrlRejectedError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlRejectedError(`Only http(s) URLs are supported: ${raw}`);
  }
  if (url.username || url.password) {
    throw new UrlRejectedError(`URLs with embedded credentials are rejected: ${raw}`);
  }
  if (guardEnabled() && !ALLOWED_PORTS.has(url.port)) {
    throw new UrlRejectedError(`Port ${url.port} is not allowed: ${raw}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) throw new UrlRejectedError(`URL has no host: ${raw}`);
  if (guardEnabled()) {
    if (host === "localhost" || RESERVED_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new UrlRejectedError(`Local hostnames are rejected: ${raw}`);
    }
    if (isIP(host) && isPrivateIp(host)) {
      throw new UrlRejectedError(`Private address rejected: ${raw}`);
    }
  }
  return url;
}

/**
 * Resolve a hostname and confirm every resolved address is public.
 * Throws UrlRejectedError when any address is private or resolution fails.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (!guardEnabled()) return;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new UrlRejectedError(`Private address rejected: ${hostname}`);
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    throw new UrlRejectedError(`DNS lookup failed for ${hostname}: ${(err as Error).message}`);
  }
  if (addresses.length === 0) {
    throw new UrlRejectedError(`No addresses resolved for ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new UrlRejectedError(`${hostname} resolves to a private address (${address})`);
    }
  }
}

/** Same-site check used by the crawler: allow the host itself or deeper subdomains. */
export function sameSite(url: URL, baseUrl: URL): boolean {
  const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");
  const a = hostOf(url);
  const b = hostOf(baseUrl);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** Best-effort registrable domain (last two labels) for grouping hosts. */
export function baseDomain(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  return parts.slice(-2).join(".");
}
