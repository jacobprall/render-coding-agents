# Feature Specification: API Key Pooling

**Feature Branch**: `012-api-key-pooling`

**Created**: 2026-05-24

**Status**: Draft

**Input**: User description: "Users have multiple API keys per provider that they rotate through to save on costs. The system should support pooling multiple keys and cycling through them to spread rate limits and stay under per-key spend tiers."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add Multiple Keys Per Provider (Priority: P1)

A user wants to register several API keys for the same LLM provider (e.g., three Anthropic keys from different billing accounts). They navigate to their key management settings, add each key in turn, and see all of them listed with status indicators. The system validates each key on entry and stores it encrypted.

**Why this priority**: Without the ability to store multiple keys per provider, no other pooling behavior is possible. This is the foundational data model change.

**Independent Test**: Can be fully tested by adding 3 keys for the same provider and verifying all appear in the key list with correct hints and active status.

**Acceptance Scenarios**:

1. **Given** a user with one existing Anthropic key, **When** they add a second Anthropic key, **Then** both keys appear in their key list with distinct labels and hints.
2. **Given** a user adding a new key, **When** the key fails provider validation (invalid/revoked), **Then** the system rejects the key with a clear error message and does not store it.
3. **Given** a user with multiple keys, **When** they view their key list, **Then** each key shows its label, last-4-char hint, status (active/rate-limited/invalid), and last-used timestamp.

---

### User Story 2 - Automatic Key Cycling During Agent Sessions (Priority: P1)

During an agent session, when the system makes LLM API calls, it automatically selects from the user's pool of keys for that provider. If one key hits a rate limit (429 response), the system transparently switches to the next available key and retries the request without interrupting the user's workflow.

**Why this priority**: This is the core value proposition — seamless cost distribution across keys without user intervention during sessions.

**Independent Test**: Can be tested by configuring two keys, simulating a rate limit on the first, and verifying the system falls back to the second without user-visible error.

**Acceptance Scenarios**:

1. **Given** a user with 3 active Anthropic keys, **When** an agent session starts making LLM calls, **Then** the system distributes calls across available keys according to the configured strategy.
2. **Given** the currently-selected key receives a 429 rate-limit response, **When** another key in the pool is available, **Then** the system retries the request with the next key without exposing the error to the user.
3. **Given** all keys in the pool are rate-limited or invalid, **When** the system attempts an LLM call, **Then** the user receives a clear message indicating all keys are exhausted and the earliest expected availability time.

---

### User Story 3 - Per-Key Usage Visibility (Priority: P2)

A user wants to understand how their keys are being utilized so they can optimize their cost strategy. They view a breakdown showing each key's usage: total spend, number of calls, and current status (active, cooling down from rate limit, invalid).

**Why this priority**: Visibility enables users to make informed decisions about adding/removing keys and adjusting their pooling strategy. Important but not blocking core functionality.

**Independent Test**: Can be tested by running several agent sessions and verifying the usage dashboard shows per-key breakdowns matching actual API call distribution.

**Acceptance Scenarios**:

1. **Given** a user with multiple keys that have been used, **When** they view the key usage breakdown, **Then** they see per-key spend totals, call counts, and last-used timestamps.
2. **Given** a key that was rate-limited during a session, **When** the user views key status, **Then** that key shows its cooldown status and approximate time until available.

---

### User Story 4 - Configure Pool Strategy (Priority: P3)

A power user wants control over how keys are selected from their pool. They choose between strategies: round-robin (even distribution), least-recently-used (natural spread), or lowest-spend (prioritize keys with more budget headroom).

**Why this priority**: Most users are well-served by the default strategy (round-robin). Custom strategies are a power-user optimization.

**Independent Test**: Can be tested by selecting different strategies and observing that key selection behavior changes accordingly across multiple LLM calls.

**Acceptance Scenarios**:

1. **Given** a user with 3 keys and "round-robin" strategy selected, **When** 6 sequential LLM calls are made, **Then** each key is used approximately twice.
2. **Given** a user switches strategy from "round-robin" to "lowest-spend", **When** subsequent calls are made, **Then** the key with the lowest accumulated spend in the current period is preferred.

---

### Edge Cases

- What happens when a key is removed from the pool while an agent session is actively using it? The current session continues with remaining keys; the removed key is not used for new calls.
- How does the system handle a key that returns an authentication error (401) vs. a rate limit (429)? A 401 marks the key as invalid (requires user re-validation); a 429 marks it as temporarily cooled down.
- What happens when a user has keys at both user scope and platform scope? User-scoped keys are pooled first; platform keys serve as a fallback pool if all user keys are exhausted.
- What happens if a key is added mid-session? It becomes available for the next LLM call in that session without requiring a restart.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to store multiple API keys per LLM provider (removing the current one-key-per-provider constraint).
- **FR-002**: System MUST validate each key against the provider's API on entry before accepting it into the pool.
- **FR-003**: System MUST encrypt all stored keys at rest using the existing encryption mechanism.
- **FR-004**: System MUST automatically select a key from the pool when making LLM API calls, using the user's configured strategy (default: round-robin).
- **FR-005**: System MUST automatically retry with the next available key when a rate-limit response (HTTP 429) is received from a provider.
- **FR-006**: System MUST mark keys as temporarily unavailable (with cooldown duration) on rate-limit responses and skip them in selection until the cooldown expires.
- **FR-007**: System MUST mark keys as invalid on authentication failures (HTTP 401/403) and exclude them from the pool until the user re-validates.
- **FR-008**: System MUST track which specific key was used for each LLM call to enable per-key usage reporting.
- **FR-009**: System MUST allow users to label, reorder, and remove keys from their pool.
- **FR-010**: System MUST support pool strategies: round-robin, least-recently-used, and lowest-spend.
- **FR-011**: System MUST inform users when all keys in a pool are exhausted (rate-limited or invalid) with an actionable message.
- **FR-012**: Platform-scoped keys MUST also support pooling, with the same selection strategies available to administrators.

### Key Entities

- **Key Pool**: A collection of API keys belonging to a user (or platform) for a single LLM provider. Has a selection strategy and contains one or more keys.
- **Pool Entry**: An individual key within a pool. Has a label, encrypted secret, status (active/rate-limited/invalid), priority/weight, last-used timestamp, cooldown expiry, and accumulated spend.
- **Pool Strategy**: The algorithm used to select the next key from a pool (round-robin, least-recently-used, lowest-spend).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can add up to 10 keys per provider and have them all function in a pool within a single agent session.
- **SC-002**: When a key is rate-limited, the system switches to an alternate key and completes the request within 2 seconds additional latency (retry overhead).
- **SC-003**: Users can see per-key usage breakdowns that accurately reflect actual call distribution (within 5% of ground truth).
- **SC-004**: 95% of rate-limit events are transparently handled without any user-visible error when alternate keys are available.
- **SC-005**: Users report reduced per-key costs through natural distribution of calls across their key pool.

## Assumptions

- Users already have multiple API keys from their providers (the system does not generate keys on their behalf).
- The existing encryption infrastructure is sufficient for storing additional keys without architectural changes.
- Provider rate-limit responses include retry-after headers or can be estimated with reasonable defaults (60-second cooldown).
- The maximum practical pool size is 10 keys per provider per user — this is sufficient for cost optimization without creating management overhead.
- The round-robin default strategy is acceptable for the majority of users; advanced strategies are a progressive enhancement.
- This feature applies to both user-scoped and platform-scoped keys, but they are managed independently (a user's pool does not merge with the platform pool; platform keys serve as fallback).
