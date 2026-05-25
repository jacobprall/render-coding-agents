import { describe, it, expect } from "bun:test";
import { buildAgentSystemPrompt } from "../src/system-prompt";

describe("buildAgentSystemPrompt", () => {
  it("never injects resolved skill content into the prompt", () => {
    const prompt = buildAgentSystemPrompt({
      resolvedSkillContents: [
        { slug: "deploy-render", content: "Deploy to Render steps." },
        { slug: "next-best-practices", content: "Next.js guidance." },
      ],
    });

    expect(prompt).not.toContain("# Skill: deploy-render");
    expect(prompt).not.toContain("Deploy to Render steps.");
    expect(prompt).not.toContain("Next.js guidance.");
  });

  it("renders skill index table without injecting bodies", () => {
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
    expect(prompt).not.toContain("Full deploy skill body.");
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

  it("includes output format guidance", () => {
    const prompt = buildAgentSystemPrompt({});

    expect(prompt).toContain("# Output format");
    expect(prompt).toContain("Format replies in Markdown");
  });
});
