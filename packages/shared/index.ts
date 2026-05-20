// ── Direct exports (owned by shared) ─────────────────────────────────────────

// Lib - Stream event types
export type { StreamEvent } from "./lib/stream-types";

// Forge types & interfaces (implementations live in @coding-agents/platform)
export type {
  ForgeProvider,
  ForgeProviderType,
  ForgeRepo,
  ForgeBranch,
  ForgePullRequest,
  ForgeFileContent,
  ForgeCommit,
  ForgeUser,
} from "./lib/forge";

// Errors + API types + logging + request ID
export {
  AgentError,
  AppError,
  AuthError,
  ChatCorruptedError,
  ChatError,
  ExecTimeoutError,
  ForgeApiError,
  ForgeError,
  ForgeUnreachableError,
  InsufficientPermissionsError,
  MaxStepsExceededError,
  ModelOverloadedError,
  ModelRateLimitedError,
  NotAuthenticatedError,
  PathTraversalError,
  RedisStreamError,
  RunAbortedError,
  SandboxError,
  SandboxProviderNotFoundError,
  SandboxUnreachableError,
  SessionArchivedError,
  SessionError,
  SessionExpiredError,
  SessionNotFoundError,
  ValidationError,
} from "./lib/errors";
export type { AppErrorOptions } from "./lib/errors";
export { generateRequestId, getRequestIdFromHeaders } from "./lib/request-id";
export type { ApiErrorResponse, ApiResponse, ApiSuccessResponse } from "./lib/api-types";
export { isApiError } from "./lib/api-types";
export { logger } from "./lib/logger";

export {
  isLlmKeyEncryptionConfigured,
  encryptLlmApiKey,
  decryptLlmApiKey,
  encryptToken,
  decryptToken,
  decryptTokenSafe,
} from "./lib/encryption";

// Model catalog (OpenAI only — Anthropic is fetched live, see apps/agent/src/models.ts)
export {
  MODEL_DEFS,
  type ModelDef,
  type ModelSummary,
} from "./lib/model-catalog";

// CI test-result parsers
export {
  parseJUnitXML,
  parseTAPOutput,
  type TestCase,
  type TestResultSummary,
  type TestSuite,
} from "./lib/ci/test-results";
