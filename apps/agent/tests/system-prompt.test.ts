import { describe, it, expect } from "bun:test";
import { buildAgentSystemPrompt } from "../src/system-prompt";

describe("buildAgentSystemPrompt", () => {
  it("does not inject skill bodies into the prompt (load_skill on demand)", () => {
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
