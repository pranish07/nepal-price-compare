import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export type UnsafeUrlCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "credentials"
  | "blocked_host"
  | "blocked_ip"
  | "blocked_port"
  | "dns_failure"
  | "empty_host";

export class UnsafeUrlError extends Error {
  readonly code = "unsafe_url";
  constructor(
    readonly reason: UnsafeUrlCode,
    message: string,
  ) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const defaultResolver: Resolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({
    address: result.address,
    family: result.family === 6 ? 6 : 4,
  }));
};

export interface ValidatedUrl {
  url: URL;
  address: string;
  family: 4 | 6;
}

export interface ValidateOptions {
  resolve?: Resolver;
  allowedPorts?: number[];
}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".localdomain",
];

const ALLOWED_PORTS = [80, 443];

function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

/**
 * True when the IP is not ordinary public unicast. Uses ipaddr.js range
 * classification so private, loopback, link-local, CGNAT, multicast, reserved,
 * documentation, 6to4, NAT64, Teredo, and IPv4-mapped private addresses are all
 * rejected. IPv4-mapped addresses are unwrapped and checked as IPv4.
 */
export function isBlockedIp(input: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(input);
  } catch {
    return true;
  }

  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      return isBlockedIp(v6.toIPv4Address().toString());
    }
  }

  return parsed.range() !== "unicast";
}

export async function validatePublicUrl(
  raw: string,
  options: ValidateOptions = {},
): Promise<ValidatedUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("invalid_url", "The URL could not be parsed.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("unsupported_protocol", "Only http and https URLs are allowed.");
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError("credentials", "URLs with embedded credentials are not allowed.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new UnsafeUrlError("empty_host", "The URL has no hostname.");
  }
  if (hostname.includes("%")) {
    throw new UnsafeUrlError("blocked_host", "IPv6 zone identifiers are not allowed.");
  }
  if (BLOCKED_HOSTS.has(hostname) || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new UnsafeUrlError("blocked_host", "That hostname is not allowed.");
  }

  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
  const allowedPorts = options.allowedPorts ?? ALLOWED_PORTS;
  if (!allowedPorts.includes(port)) {
    throw new UnsafeUrlError("blocked_port", "Only standard web ports (80/443) are allowed.");
  }

  let addresses: ResolvedAddress[];
  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    addresses = [{ address: hostname, family: literalFamily === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await (options.resolve ?? defaultResolver)(hostname);
    } catch {
      throw new UnsafeUrlError("dns_failure", "The hostname could not be resolved.");
    }
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError("dns_failure", "The hostname resolved to no addresses.");
  }

  for (const candidate of addresses) {
    if (isBlockedIp(candidate.address)) {
      throw new UnsafeUrlError(
        "blocked_ip",
        "That host resolves to a private or reserved address.",
      );
    }
  }

  const first = addresses[0];
  if (!first) {
    throw new UnsafeUrlError("dns_failure", "The hostname resolved to no addresses.");
  }

  return { url, address: first.address, family: first.family };
}
