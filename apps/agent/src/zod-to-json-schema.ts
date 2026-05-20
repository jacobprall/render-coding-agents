import { z } from "zod";

/**
 * Convert a Zod schema to a JSON Schema object suitable for LLM tool definitions.
 * Uses Zod v4's built-in toJsonSchema() method.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}
