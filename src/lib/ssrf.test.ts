import { describe, expect, it } from "vitest";
import {
  UnsafeUrlError,
  isBlockedIp,
  validatePublicUrl,
  type ResolvedAddress,
} from "./ssrf";

const publicResolver = async (): Promise<ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

async function expectCode(url: string, code: string, options = {}) {
  await expect(validatePublicUrl(url, options)).rejects.toMatchObject({ code: "unsafe_url", reason: code });
}

describe("isBlockedIp", () => {
  it("blocks private, loopback, link-local, and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "240.0.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public unicast addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "::ffff:8.8.8.8", "2606:4700:4700::1111"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("treats unparseable input as blocked", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });
});

describe("validatePublicUrl", () => {
  it("accepts a public hostname and returns the pinned address", async () => {
    const result = await validatePublicUrl("https://example.com/product", {
      resolve: publicResolver,
    });
    expect(result.address).toBe("93.184.216.34");
    expect(result.family).toBe(4);
    expect(result.url.hostname).toBe("example.com");
  });

  it("accepts a literal public IP without DNS", async () => {
    const result = await validatePublicUrl("http://93.184.216.34/", {
      resolve: async () => {
        throw new Error("resolver should not be called");
      },
    });
    expect(result.address).toBe("93.184.216.34");
  });

  it("rejects non-http protocols", async () => {
    await expectCode("ftp://example.com/", "unsupported_protocol");
    await expectCode("file:///etc/passwd", "unsupported_protocol");
  });

  it("rejects embedded credentials", async () => {
    await expectCode("https://user:pass@example.com/", "credentials");
  });

  it("rejects blocked hostnames and suffixes", async () => {
    await expectCode("http://localhost/", "blocked_host");
    await expectCode("http://metadata.google.internal/", "blocked_host");
    await expectCode("http://foo.local/", "blocked_host");
    await expectCode("http://service.internal/", "blocked_host");
  });

  it("rejects non-standard ports", async () => {
    await expectCode("https://example.com:8443/", "blocked_port");
    await expectCode("http://example.com:22/", "blocked_port");
  });

  it("rejects IPv6 zone identifiers", async () => {
    // WHATWG URL parsing rejects zone IDs outright, before the hostname guard.
    await expectCode("http://[fe80::1%25eth0]/", "invalid_url");
  });

  it("rejects literal private IPs", async () => {
    await expectCode("http://127.0.0.1/", "blocked_ip");
    await expectCode("http://[::1]/", "blocked_ip");
    await expectCode("http://[::ffff:127.0.0.1]/", "blocked_ip");
  });

  it("rejects a hostname that resolves to a private address", async () => {
    await expectCode("https://evil.example/", "blocked_ip", {
      resolve: async () => [{ address: "10.0.0.5", family: 4 }],
    });
  });

  it("rejects when any resolved address is private", async () => {
    await expectCode("https://mixed.example/", "blocked_ip", {
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.0.1", family: 4 },
      ],
    });
  });

  it("rejects DNS failures and empty answers", async () => {
    await expectCode("https://nope.example/", "dns_failure", {
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    await expectCode("https://empty.example/", "dns_failure", {
      resolve: async () => [],
    });
  });

  it("rejects an invalid URL", async () => {
    await expect(validatePublicUrl("not a url")).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
