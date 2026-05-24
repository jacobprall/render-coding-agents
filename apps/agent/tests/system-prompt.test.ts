import { describe, it, expect } from "bun:test";
import { buildAgentSystemPrompt } from "../src/system-prompt";

describe("buildAgentSystemPrompt", () => {
  it("injects resolved skill content sections", () => {
    const prompt = buildAgentSystemPrompt({
      resolvedSkillContents: [
        { slug: "deploy-render", content: "Deploy to Render steps." },
        { slug: "next-best-practices", content: "Next.js guidance." },
      ],
    });

    expect(prompt).toContain("# Skill: deploy-render");
    expect(prompt).toContain("Deploy to Render steps.");
    expect(prompt).toContain("# Skill: next-best-practices");
    expect(prompt).toContain("Next.js guidance.");
  });

  it("produces no skill sections when resolvedSkillContents is empty", () => {
    const prompt = buildAgentSystemPrompt({
      resolvedSkillContents: [],
    });

    expect(prompt).not.toContain("# Skill:");
  });

  it("renders skill index table alongside resolved content", () => {
    const prompt = buildAgentSystemPrompt({
      skillIndex: [
        {
          source: "builtin",
          slug: "deploy-render",
          name: "Deploy Render",
          description: "Deploy apps to Render",
          defaultEnabled: true,
        },
      ],
      resolvedSkillContents: [
        { slug: "deploy-render", content: "Full deploy skill body." },
      ],
    });

    expect(prompt).toContain("# Available skills");
    expect(prompt).toContain("| builtin/deploy-render | Deploy Render | Deploy apps to Render |");
    expect(prompt).toContain("# Skill: deploy-render");
    expect(prompt).toContain("Full deploy skill body.");
  });

  it("excludes skill content in scratch mode", () => {
    const prompt = buildAgentSystemPrompt({
      isScratch: true,
      resolvedSkillContents: [
        { slug: "deploy-render", content: "Should not appear in scratch." },
      ],
    });

    expect(prompt).not.toContain("# Skill: deploy-render");
    expect(prompt).not.toContain("Should not appear in scratch.");
  });

  it("still injects projectContext and projectConfig.instructions", () => {
    const prompt = buildAgentSystemPrompt({
      projectContext: "Monorepo with apps/web and apps/agent.",
      projectConfig: {
        instructions: "Always run tests before committing.",
      },
    });

    expect(prompt).toContain("# Project context");
    expect(prompt).toContain("Monorepo with apps/web and apps/agent.");
    expect(prompt).toContain("# Project instructions");
    expect(prompt).toContain("Always run tests before committing.");
  });
});
