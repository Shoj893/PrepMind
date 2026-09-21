import { describe, expect, it } from "vitest";
import { assertFetchableUrl, isPrivateIp, sameSite, UrlRejectedError } from "@/core/retrieval/url";

describe("isPrivateIp", () => {
  it("rejects private, loopback, link-local and reserved ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "::1",
      "::",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111", "100.63.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe("assertFetchableUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(assertFetchableUrl("https://example.com/careers").hostname).toBe("example.com");
    expect(assertFetchableUrl("http://example.com", "https://example.com/x").toString()).toContain("http://example.com/");
  });

  it("rejects non-http schemes, credentials and bad ports", () => {
    expect(() => assertFetchableUrl("ftp://example.com")).toThrow(UrlRejectedError);
    expect(() => assertFetchableUrl("file:///etc/passwd")).toThrow(UrlRejectedError);
    expect(() => assertFetchableUrl("https://user:pass@example.com")).toThrow(UrlRejectedError);
    expect(() => assertFetchableUrl("https://example.com:8080/")).toThrow(UrlRejectedError);
  });

  it("rejects literal private addresses and local hostnames", () => {
    expect(() => assertFetchableUrl("http://127.0.0.1/")).toThrow(UrlRejectedError);
    expect(() => assertFetchableUrl("http://10.0.0.1/")).toThrow(UrlRejectedError);
    expect(() => assertFetchableUrl("http://169.254.169.254/latest/meta-data")).toThrow(UrlRejectedError);
    expect(() => assertFetchableUrl("http://localhost:3000/")).toThrow(UrlRejectedError);
    expect(() => assertFetchableUrl("http://internal.corp/x")).toThrow(UrlRejectedError);
  });

  it("resolves relative URLs against a base", () => {
    expect(assertFetchableUrl("/careers", "https://example.com/about").toString()).toBe(
      "https://example.com/careers"
    );
  });
});

describe("sameSite", () => {
  it("allows same host and subdomains, rejects other sites", () => {
    const base = new URL("https://example.com");
    expect(sameSite(new URL("https://example.com/careers"), base)).toBe(true);
    expect(sameSite(new URL("https://www.example.com/careers"), base)).toBe(true);
    expect(sameSite(new URL("https://blog.example.com/post"), base)).toBe(true);
    expect(sameSite(new URL("https://notexample.com/"), base)).toBe(false);
    expect(sameSite(new URL("https://evil-example.com/"), base)).toBe(false);
  });
});
