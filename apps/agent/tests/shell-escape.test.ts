import { describe, it, expect } from "bun:test";
import { shellEscape } from "../src/lib/shell-escape";

describe("shellEscape", () => {
  it("wraps plain strings in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it("handles shell metacharacters safely", () => {
    expect(shellEscape("$(rm -rf /)")).toBe("'$(rm -rf /)'");
    expect(shellEscape("`whoami`")).toBe("'`whoami`'");
    expect(shellEscape("a | b")).toBe("'a | b'");
    expect(shellEscape("foo; bar")).toBe("'foo; bar'");
    expect(shellEscape("$HOME")).toBe("'$HOME'");
    expect(shellEscape("a && b")).toBe("'a && b'");
  });

  it("returns empty single-quoted string for empty input", () => {
    expect(shellEscape("")).toBe("''");
  });

  it("throws on null bytes", () => {
    expect(() => shellEscape("foo\0bar")).toThrow("Null byte in shell argument");
  });

  it("handles branch names with special chars", () => {
    expect(shellEscape("feat/user#42")).toBe("'feat/user#42'");
    expect(shellEscape("fix/issue (WIP)")).toBe("'fix/issue (WIP)'");
  });

  it("handles paths with spaces", () => {
    expect(shellEscape("/path/to/my file.txt")).toBe("'/path/to/my file.txt'");
  });

  it("handles strings with multiple single quotes", () => {
    expect(shellEscape("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''");
  });
});
