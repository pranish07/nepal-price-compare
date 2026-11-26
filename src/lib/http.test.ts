import { describe, expect, it } from "vitest";
import { DomainLimiter, safeFetchHtml } from "./http";
import { UnsafeUrlError } from "./ssrf";

describe("DomainLimiter", () => {
  it("spaces requests to the same host and not across hosts", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const limiter = new DomainLimiter(
      500,
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    );

    await limiter.wait("a.example");
    now = 100;
    await limiter.wait("a.example");
    await limiter.wait("b.example");

    expect(sleeps).toEqual([400]);
  });
});

describe("safeFetchHtml", () => {
  it("refuses a hostname that resolves to a private address before connecting", async () => {
    await expect(
      safeFetchHtml("https://evil.example/product", {
        resolve: async () => [{ address: "10.0.0.5", family: 4 }],
      }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("refuses non-http URLs", async () => {
    await expect(safeFetchHtml("file:///etc/passwd")).rejects.toMatchObject({
      reason: "unsupported_protocol",
    });
  });
});
