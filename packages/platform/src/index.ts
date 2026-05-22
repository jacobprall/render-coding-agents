// Core interfaces
export type { PlatformDb } from "./interfaces/database";
export { createDb } from "./interfaces/database";
export type { AuthContext } from "./interfaces/auth";
export type { QueueAdapter } from "./interfaces/queue";
export { RedisQueueAdapter } from "./interfaces/queue";
export type { EventBus } from "./interfaces/events";
export { RedisEventBus } from "./interfaces/events";

// Forge provider abstraction
export { createForgeProvider, getDefaultForgeProvider, getForgeProviderForAuth } from "./forge";
export type {
  ForgeProvider,
  ForgeProviderType,
  ForgeProviderConfig,
  ForgeRepo,
  ForgeBranch,
  ForgePullRequest,
  ForgeFileContent,
  ForgeCommit,
  ForgeReview,
  ForgeComment,
  ForgeUser,
  ForgeOrg,
  ForgeOrgMember,
  ForgeArtifact,
  ForgeCommitStatus,
  ForgeCombinedStatus,
  ForgeWebhookEvent,
  ForgePushEvent,
  ForgePREvent,
  ForgeWorkflowRunEvent,
  ForgeStatusEvent,
  BranchProtectionRule,
  CreateRepoParams,
  CreatePRParams,
  ReviewEvent,
  MergeMethod,
} from "./forge";

// Redis Streams agent job queue
export {
  AGENT_JOBS_GROUP,
  AGENT_JOBS_STREAM,
  AgentJobSchema,
  ackJob,
  enqueueJob,
  ensureConsumerGroup,
  reclaimStalePending,
  readOneJob,
  type ValidatedAgentJob,
} from "./queue/job-queue";

// Run event stream
export {
  askUserReplyQueueKey,
  publishRunEvent,
  readRunEventHistory,
  readRunEventHistoryDetailed,
  readRunEventEntriesAfterId,
  readRunEventPayloadsAfterId,
  runEventStreamKey,
  trimOldStreamEntries,
} from "./events/run-stream";

// LLM API keys (encrypted storage + resolution)
export {
  decryptLlmApiKey,
  encryptLlmApiKey,
  isLlmKeyEncryptionConfigured,
} from "./auth/encryption";
export {
  llmKeyHint,
  validateAnthropicApiKey,
  validateOpenAiApiKey,
} from "./auth/llm-key-validation";
export { resolveLlmApiKeys, type ResolvedLlmKeys } from "./auth/api-key-resolver";

// Services
export { SessionService } from "./services/session";
export type {
  CreateSessionParams,
  SendMessageParams,
  ReplyParams,
  SpecActionParams,
  ReviewJobParams,
  AutoTitleResult,
  AgentTrigger,
} from "./services/session";
export {
  ObservabilityService,
} from "./services/observability";
export type {
  EventQueryOptions,
  NewAgentEventInput,
  UsageAggregateOptions,
  UsageAggregateResult,
} from "./services/observability";
export {
  OtlpExporter,
} from "./observability/otel-exporter";
export type {
  OtlpSpanEvent,
} from "./observability/otel-exporter";

// Object storage
export type {
  StorageAdapter,
  StorageObject,
  ListObjectsOptions,
  ListObjectsResult,
  PutObjectOptions,
  GetObjectResult,
  S3StorageConfig,
} from "./interfaces/storage";
export { S3StorageAdapter } from "./storage/s3-adapter";
export { LocalStorageAdapter } from "./storage/local-adapter";
export { MemoryStorageAdapter } from "./storage/memory-adapter";

// Cache adapter
export type { CacheAdapter } from "./interfaces/cache";
export { RedisCacheAdapter, MemoryCacheAdapter } from "./interfaces/cache";

// Notification sink
export type { NotificationSink, NotificationPayload, NotificationLevel } from "./interfaces/notification-sink";
export { ConsoleSink, WebhookSink, CompositeSink, NoopSink } from "./interfaces/notification-sink";

// Auth provider
export type { AuthProvider } from "./interfaces/auth-provider";
export { StaticTokenAuthProvider, CompositeAuthProvider } from "./interfaces/auth-provider";

// Permissions layer — cost guard, tool filter, credential redactor
export type {
  PermissionPolicy,
  ToolPermissions,
  CostPermissions,
  CredentialPermissions,
  SandboxPermissions,
  CostGuardState,
  CostGuardDecision,
  CanDispatchResult,
  ToolFilterDecision,
  ModelPricing,
} from "./policy";
export {
  DEFAULT_POLICY,
  resolvePolicy,
  evaluateCost,
  canDispatch,
  evaluateTool,
  filterTools,
  redactCredentials,
  containsCredentials,
  MODEL_PRICING,
  calculateCost,
} from "./policy";

// Agent run state machine
export {
  AgentRunStateMachine,
  assertValidTransition,
  InvalidRunTransitionError,
  runStateMachine,
} from "./state-machine";
export type { AgentRunStatus, AgentRunEvent, TerminalReason } from "./state-machine";

// Composition root
export { createPlatform, createPlatformFromInstances } from "./container";
export type { PlatformConfig, PlatformInstances, PlatformContainer } from "./container";

// Inbound event layer — InboundEvent, Router, Dispatcher, adapters
export type {
  InboundEvent,
  InboundSource,
  InboundKind,
  InboundActor,
  InboundRepo,
  InboundPR,
  RouteAction,
  TriggerSessionAction,
  CreateDiagnosticSessionAction,
  CoalesceAction,
  IgnoreAction,
  SessionMatcher,
  InboundRoute,
  AgentTriggerKind,
} from "./inbound";
export { InboundRouter, InboundDispatcher, DEFAULT_ROUTES } from "./inbound";
export {
  githubWebhookToInboundEvent,
} from "./inbound";

// Jobs
export { startObservabilityRetentionLoop } from "./jobs/retention";
