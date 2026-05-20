/**
 * Re-export all schema tables and types from domain-specific modules.
 * Preserves backward compatibility — existing `import { ... } from "@coding-agents/db/schema"` continues to work.
 */
export * from "./schema/index";
