/**
 * Browser-safe exports from @coding-agents/shared.
 * Do not import server-only modules (encryption, logger, etc.) here.
 */
export type { StreamEvent, StreamEventType } from "./lib/stream-types";
export { isTerminalEvent } from "./lib/stream-types";
export {
  MODEL_DEFS,
  type ModelDef,
  type ModelSummary,
} from "./lib/model-catalog";
