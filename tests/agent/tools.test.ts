import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { defineTool, type ToolConfig } from "../../apps/agent/src/tools/define-tool";
import { zodToJsonSchema } from "../../apps/agent/src/zod-to-json-schema";
import type { AgentTool } from "../../apps/agent/src/loop";
import type { ToolDefinition } from "../../apps/agent/src/llm/types";

// ---------------------------------------------------------------------------
// defineTool
// ---------------------------------------------------------------------------

describe("defineTool", () => {
  it("produces a ToolConfig with description, inputSchema, and execute", () => {
    const tool = defineTool({
      description: "Run a shell command",
      inputSchema: z.object({ command: z.string() }),
      execute: async (input) => ({ output: `ran: ${input.command}` }),
    });

    expect(tool.description).toBe("Run a shell command");
    expect(tool.inputSchema).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  it("preserves the execute function and it validates input via Zod", async () => {
    const tool = defineTool({
      description: "Add numbers",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async (input) => input.a + input.b,
    });

    const result = await tool.execute({ a: 3, b: 4 }, { context: null });
    expect(result).toBe(7);
  });

  it("allows optional fields in the schema", () => {
    const tool = defineTool({
      description: "Optional test",
      inputSchema: z.object({
        required: z.string(),
        optional: z.string().optional(),
      }),
      execute: async (input) => input.required,
    });

    expect(tool.description).toBe("Optional test");
  });
});

// ---------------------------------------------------------------------------
// zodToJsonSchema
// ---------------------------------------------------------------------------

describe("zodToJsonSchema", () => {
  it("converts a simple object schema to valid JSON Schema", () => {
    const schema = z.object({
      command: z.string(),
      timeout: z.number().optional(),
    });

    const jsonSchema = zodToJsonSchema(schema);

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toBeDefined();
    const props = jsonSchema.properties as Record<string, unknown>;
    expect(props.command).toBeDefined();
    expect(props.timeout).toBeDefined();
  });

  it("marks required fields correctly", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
    });

    const jsonSchema = zodToJsonSchema(schema);
    const required = jsonSchema.required as string[] | undefined;

    expect(required).toContain("name");
    if (required) {
      expect(required).not.toContain("age");
    }
  });

  it("handles string enums", () => {
    const schema = z.object({
      color: z.enum(["red", "green", "blue"]),
    });

    const jsonSchema = zodToJsonSchema(schema);
    const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
    const colorSchema = props.color;
    const hasEnum = colorSchema?.enum || colorSchema?.anyOf;
    expect(hasEnum).toBeTruthy();
  });

  it("handles arrays", () => {
    const schema = z.object({
      items: z.array(z.string()),
    });

    const jsonSchema = zodToJsonSchema(schema);
    const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.items?.type).toBe("array");
  });

  it("handles nested objects", () => {
    const schema = z.object({
      outer: z.object({
        inner: z.string(),
      }),
    });

    const jsonSchema = zodToJsonSchema(schema);
    const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.outer?.type).toBe("object");
    const outerProps = props.outer?.properties as Record<string, unknown>;
    expect(outerProps?.inner).toBeDefined();
  });

  it("converts a plain string schema", () => {
    const schema = z.string();
    const jsonSchema = zodToJsonSchema(schema);
    expect(jsonSchema.type).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// ToolConfig -> AgentTool integration
// ---------------------------------------------------------------------------

function toolConfigsToAgentTools(
  configs: Record<string, ToolConfig>,
  context: unknown,
): Map<string, AgentTool> {
  const tools = new Map<string, AgentTool>();
  for (const [name, cfg] of Object.entries(configs)) {
    tools.set(name, {
      definition: {
        name,
        description: cfg.description,
        input_schema: zodToJsonSchema(cfg.inputSchema),
      },
      execute: (input) => {
        const parsed = cfg.inputSchema.parse(input);
        return cfg.execute(parsed, { context });
      },
    });
  }
  return tools;
}

describe("toolConfigsToAgentTools", () => {
  it("converts ToolConfig records into AgentTool map entries", () => {
    const configs: Record<string, ToolConfig> = {
      greet: defineTool({
        description: "Greet someone",
        inputSchema: z.object({ name: z.string() }),
        execute: async (input) => `Hello, ${input.name}!`,
      }),
    };

    const tools = toolConfigsToAgentTools(configs, { workDir: "/tmp" });

    expect(tools.size).toBe(1);
    const greetTool = tools.get("greet");
    expect(greetTool).toBeTruthy();
    expect(greetTool!.definition.name).toBe("greet");
    expect(greetTool!.definition.description).toBe("Greet someone");
    expect(greetTool!.definition.input_schema).toBeDefined();
    expect(typeof greetTool!.definition.input_schema).toBe("object");
  });

  it("executes the underlying tool function with parsed input", async () => {
    const configs: Record<string, ToolConfig> = {
      add: defineTool({
        description: "Add two numbers",
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async (input) => ({ sum: input.a + input.b }),
      }),
    };

    const tools = toolConfigsToAgentTools(configs, null);
    const addTool = tools.get("add")!;
    const result = await addTool.execute({ a: 5, b: 3 });

    expect(result).toEqual({ sum: 8 });
  });

  it("rejects invalid input via Zod validation", async () => {
    const configs: Record<string, ToolConfig> = {
      strict: defineTool({
        description: "Strict input",
        inputSchema: z.object({ count: z.number() }),
        execute: async (input) => input.count,
      }),
    };

    const tools = toolConfigsToAgentTools(configs, null);
    const strictTool = tools.get("strict")!;

    expect(() => strictTool.execute({ count: "not-a-number" })).toThrow();
  });

  it("builds multiple tools from a config set", () => {
    const configs: Record<string, ToolConfig> = {
      tool_a: defineTool({
        description: "Tool A",
        inputSchema: z.object({ x: z.string() }),
        execute: async () => "a",
      }),
      tool_b: defineTool({
        description: "Tool B",
        inputSchema: z.object({ y: z.number() }),
        execute: async () => "b",
      }),
      tool_c: defineTool({
        description: "Tool C",
        inputSchema: z.object({}),
        execute: async () => "c",
      }),
    };

    const tools = toolConfigsToAgentTools(configs, null);
    expect(tools.size).toBe(3);
    expect(tools.has("tool_a")).toBe(true);
    expect(tools.has("tool_b")).toBe(true);
    expect(tools.has("tool_c")).toBe(true);
  });
});
