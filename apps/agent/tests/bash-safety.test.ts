import { describe, it, expect } from "bun:test";
import { bashInvokesRemoteGit } from "../src/tools/bash";

describe("bashInvokesRemoteGit", () => {
  it("detects git push", () => {
    expect(bashInvokesRemoteGit("git push origin main")).toBe(true);
  });

  it("detects git push with -c config flag", () => {
    expect(bashInvokesRemoteGit("git -c http.proxy=x push origin main")).toBe(true);
  });

  it("detects git push with --git-dir", () => {
    expect(bashInvokesRemoteGit("git --git-dir=/tmp push")).toBe(true);
  });

  it("does not false-match git push inside quoted echo", () => {
    expect(bashInvokesRemoteGit('echo "git push"')).toBe(false);
  });

  it("ignores git status", () => {
    expect(bashInvokesRemoteGit("git status")).toBe(false);
  });

  it("ignores git log", () => {
    expect(bashInvokesRemoteGit("git log --oneline")).toBe(false);
  });

  it("ignores add and commit without push", () => {
    expect(bashInvokesRemoteGit("git add . && git commit -m 'test'")).toBe(false);
  });

  it("detects push in compound command", () => {
    expect(bashInvokesRemoteGit("git add . && git push origin main")).toBe(true);
  });
});
