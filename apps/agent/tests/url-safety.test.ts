import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { assertSafeHttpUrl } from "../src/url-safety";

describe("assertSafeHttpUrl", () => {
  const originalEnv = process.env.SANDBOX_SERVICE_HOST;

  beforeEach(() => {
    process.env.SANDBOX_SERVICE_HOST = "sandbox.internal:8080";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SANDBOX_SERVICE_HOST = originalEnv;
    } else {
      delete process.env.SANDBOX_SERVICE_HOST;
    }
  });

  describe("valid URLs", () => {
    it("allows https URLs on standard ports", async () => {
      const url = await assertSafeHttpUrl("https://example.com/path");
      expect(url.hostname).toBe("example.com");
    });

    it("allows http URLs on port 80", async () => {
      const url = await assertSafeHttpUrl("http://example.com/path");
      expect(url.hostname).toBe("example.com");
    });

    it("allows port 8080", async () => {
      const url = await assertSafeHttpUrl("http://example.com:8080/path");
      expect(url.port).toBe("8080");
    });

    it("allows port 8443", async () => {
      const url = await assertSafeHttpUrl("https://example.com:8443/path");
      expect(url.port).toBe("8443");
    });
  });

  describe("private IP detection", () => {
    it("rejects 127.0.0.1 (loopback)", async () => {
      await expect(assertSafeHttpUrl("http://127.0.0.1/")).rejects.toThrow("not allowed");
    });

    it("rejects 10.x.x.x (private)", async () => {
      await expect(assertSafeHttpUrl("http://10.0.0.1/")).rejects.toThrow("not allowed");
    });

    it("rejects 172.16-31.x.x (private)", async () => {
      await expect(assertSafeHttpUrl("http://172.16.0.1/")).rejects.toThrow("not allowed");
      await expect(assertSafeHttpUrl("http://172.31.255.255/")).rejects.toThrow("not allowed");
    });

    it("rejects 192.168.x.x (private)", async () => {
      await expect(assertSafeHttpUrl("http://192.168.1.1/")).rejects.toThrow("not allowed");
    });

    it("rejects 169.254.x.x (link-local)", async () => {
      await expect(assertSafeHttpUrl("http://169.254.1.1/")).rejects.toThrow("not allowed");
    });

    it("rejects 0.x.x.x", async () => {
      await expect(assertSafeHttpUrl("http://0.0.0.0/")).rejects.toThrow("not allowed");
    });

    it("rejects 100.64-127.x.x (CGNAT)", async () => {
      await expect(assertSafeHttpUrl("http://100.64.0.1/")).rejects.toThrow("not allowed");
      await expect(assertSafeHttpUrl("http://100.127.255.255/")).rejects.toThrow("not allowed");
    });
  });

  describe("SSRF hardening", () => {
    it("rejects localhost", async () => {
      await expect(assertSafeHttpUrl("http://localhost/")).rejects.toThrow("not allowed");
    });

    it("rejects .localhost subdomains", async () => {
      await expect(assertSafeHttpUrl("http://foo.localhost/")).rejects.toThrow("not allowed");
    });

    it("rejects .local domains", async () => {
      await expect(assertSafeHttpUrl("http://foo.local/")).rejects.toThrow("not allowed");
    });

    it("rejects sandbox host", async () => {
      await expect(assertSafeHttpUrl("http://sandbox.internal/")).rejects.toThrow("not allowed");
    });

    it("rejects IPv6 loopback", async () => {
      await expect(assertSafeHttpUrl("http://[::1]/")).rejects.toThrow();
    });
  });

  describe("port restrictions", () => {
    it("rejects non-standard ports", async () => {
      await expect(assertSafeHttpUrl("http://example.com:9090/")).rejects.toThrow("port is not allowed");
    });

    it("rejects port 22 (SSH)", async () => {
      await expect(assertSafeHttpUrl("http://example.com:22/")).rejects.toThrow("port is not allowed");
    });
  });

  describe("protocol validation", () => {
    it("rejects non-http protocols", async () => {
      await expect(assertSafeHttpUrl("ftp://example.com/")).rejects.toThrow("Only http and https");
    });

    it("rejects file protocol", async () => {
      await expect(assertSafeHttpUrl("file:///etc/passwd")).rejects.toThrow("Only http and https");
    });

    it("rejects invalid URLs", async () => {
      await expect(assertSafeHttpUrl("not-a-url")).rejects.toThrow("Invalid URL");
    });
  });
});
