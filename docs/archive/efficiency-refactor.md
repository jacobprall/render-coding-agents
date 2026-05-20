# Efficiency Refactor: Token Optimization & Cost Reduction

This document defines the scope for minimizing per-turn and per-session LLM costs through caching, token optimization, and intelligent model routing. It complements R3 (Cost Control) in the refactor plan — R3 instruments and enforces budgets; this refactor reduces the spend that hits those budgets.

---

## Current Cost Profile

A single agent turn with default configuration:

| Component | Tokens/call | Notes |
|-----------|------------|-------|
| System prompt (base) | ~2,000 | Identity, lifecycle, tools guidance, operational notes |
| Default skills (react + next best practices) | ~50,000 | Injected wholesale into system prompt every call |
| Tool definitions (~23 tools) | ~5,000 | Full JSON Schema for every tool, every call |
| Conversation history | Variable | Grows unbounded across steps and turns |
| **Total per LLM call (step 1)** | **~57,000+ input** | Before any conversation history |

Within a single turn, the agent loop runs up to 100 steps. Each step resends the full system prompt, all tool definitions, and the growing message history. A 10-step turn with default skills sends **~570K+ input tokens** in system prompt and tools alone, plus growing history.

**No caching, no compaction, no context window management exists today.**

---

## E1: Anthropic Prompt Caching

**Status:** DONE
**Scope:** `apps/agent/src/llm/anthropic.ts`
**Expected savings:** 60–80% reduction in Anthropic input token costs

Anthropic's prompt caching charges 0.1x for cached reads vs 1.25x for cache writes. Since the system prompt, tool definitions, and conversation prefix are identical across steps within a turn, this is the highest-leverage single change.

### Implementation

1. **Add beta header:** Include `anthropic-beta: prompt-caching-2024-07-31` in request headers.

2. **Mark system prompt for caching:** Convert the `system` field from a plain string to a structured block with `cache_control`:
   ```json
   "system": [
     { "type": "text", "text": "<system prompt>", "cache_control": { "type": "ephemeral" } }
   ]
   ```

3. **Mark tool definitions for caching:** Add `cache_control: { "type": "ephemeral" }` to the last tool in the `tools` array (Anthropic caches everything up to and including the marked block).

4. **Mark conversation prefix for caching:** On multi-step calls within a turn, mark the last message from the previous step with `cache_control` so the provider caches the full prefix and only processes the new delta.

5. **Track cache metrics:** Parse `cache_creation_input_tokens` and `cache_read_input_tokens` from SSE `message_start` usage. Record alongside existing `inputTokens`/`outputTokens` for observability (feeds into R3/R4).

### Design notes

- Cache TTL is 5 minutes (Anthropic-managed). Within a single turn, steps fire within seconds — cache hits are near-guaranteed.
- Across turns in the same session, cache may still be warm if turns are close together.
- The `ephemeral` cache type is appropriate — we don't need persistent cross-session caching.
- OpenAI automatically caches identical prompt prefixes; no code changes needed for their provider.

---

## E2: Skills as Tools (Lazy Skill Loading)

**Status:** DONE
**Scope:** `apps/agent/src/skills/`, `apps/agent/src/system-prompt.ts`, `apps/agent/src/tool-registry.ts`
**Expected savings:** ~50,000 tokens/call eliminated from system prompt when skills aren't needed

Instead of injecting full skill markdown (~190 KB for defaults) into the system prompt on every call, provide skill summaries in the prompt and a tool for the agent to load full content on demand.

### Design

**System prompt receives a skill index (not full content):**

```
# Available skills

You have access to specialized knowledge through skills. Use `load_skill` to read a skill's full content when you need its guidance.

| ID | Name | Summary |
|----|------|---------|
| builtin/react-best-practices | React Best Practices | React/Next.js performance patterns: memoization, server components, data fetching, bundle optimization |
| builtin/next-best-practices | Next.js Best Practices | App Router conventions, RSC boundaries, metadata, error handling, route handlers, image/font optimization |
| user/my-custom-skill | My Custom Skill | Team-specific coding conventions and patterns |
| repo/api-guidelines | API Guidelines | REST API design patterns for this project |
```

**New tool — `load_skill`:**

```typescript
{
  name: "load_skill",
  description: "Load the full content of a skill by ID. Use when you need detailed guidance for a specific technology or pattern.",
  input_schema: {
    type: "object",
    properties: {
      skill_id: {
        type: "string",
        description: "The skill ID from the available skills list (e.g. 'builtin/react-best-practices')"
      }
    },
    required: ["skill_id"]
  }
}
```

### Implementation

1. **Build skill index:** At turn start, generate a summary table from `SkillSummary` data (already available via `listBuiltinSummaries`, `listRepoSkillSummaries`, `listUserSkillSummaries`). Include `source/slug` as the ID, `name`, and `description` from frontmatter.

2. **Inject index into system prompt:** Replace the `# Additional skills & instructions` block in `buildAgentSystemPrompt()` with the compact index table (~200–500 tokens total vs ~50,000).

3. **Register `load_skill` tool:** Add to `tool-registry.ts`. The execute function resolves the skill by `source` and `slug` using existing `getBuiltinRaw()` / `readSkillFileFromRepo()` and returns the full markdown body.

4. **Cache loaded skills in context:** Once a skill is loaded within a turn, cache it in the `ForgeAgentContext` so repeated `load_skill` calls for the same ID return instantly without re-reading.

5. **Remove `DEFAULT_ACTIVE_SKILL_REFS` auto-injection:** Skills are always available via the index. The agent decides when to load them based on the task at hand. No per-session "active skills" list needed for the system prompt — the list only controls which skills appear in the index.

### Design notes

- The agent naturally loads relevant skills. A React task triggers `load_skill("builtin/react-best-practices")`. A backend refactor loads nothing.
- Skill content enters the conversation as a tool result, which benefits from E1 (prompt caching) on subsequent steps.
- `description` in skill frontmatter becomes important — it's what the agent uses to decide whether to load. Ensure all skills have good descriptions.
- Subagents (E4) do NOT get `load_skill` — they receive any necessary skill content inline in their task description from the parent.

---

## E3: Tool Result Compaction

**Status:** DONE
**Scope:** `apps/agent/src/loop.ts`, `apps/agent/src/llm/types.ts`
**Expected savings:** Prevents unbounded context growth in long turns; keeps conversations within context window

Large tool results (file reads, grep output, bash output) accumulate in the message history and are re-sent on every subsequent step. A 10-step turn where the agent reads 5 files can have 100K+ tokens in stale tool results.

### Design

**Compaction strategy — replace stale tool results with pointers:**

After a tool result has been processed by the model (i.e., the model has produced a response that follows it), replace the full content with a compact pointer:

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_abc123",
  "content": "[Compacted — use get_tool_result(\"toolu_abc123\") to retrieve full content]"
}
```

**New tool — `get_tool_result`:**

```typescript
{
  name: "get_tool_result",
  description: "Retrieve the full content of a previously compacted tool result. Use when you need to re-examine output from an earlier step.",
  input_schema: {
    type: "object",
    properties: {
      tool_call_id: {
        type: "string",
        description: "The tool_call_id of the result to retrieve"
      }
    },
    required: ["tool_call_id"]
  }
}
```

### Implementation

1. **Result store:** Add an in-memory `Map<string, string>` to the agent loop context, keyed by `tool_use_id`, storing the full serialized result.

2. **Compaction threshold:** Only compact results larger than a configurable threshold (e.g., 2,000 characters / ~500 tokens). Small results stay inline — the pointer overhead isn't worth it.

3. **Compaction timing:** Before each `provider.chat()` call in the loop, scan `allMessages` for tool results from completed steps (not the current step). Replace eligible results with pointer text.

4. **Compaction metadata:** The pointer text includes the tool name and a one-line summary (first 100 chars of original output) so the model has some signal without needing to reload:
   ```
   [Compacted: read_file output (468 lines). First line: "import { useState } from 'react';". Use get_tool_result("toolu_abc123") to retrieve.]
   ```

5. **Register `get_tool_result` tool:** Execute function looks up the ID in the result store and returns the full content (or an error if the ID is unknown).

6. **Preserve non-compactable results:** Tool results that are errors (`is_error: true`) or very small are never compacted.

### Design notes

- Compaction is within-turn only. Across turns, `modelMessages` already stores only delta messages (new messages from that turn), so prior-turn results aren't re-sent in full.
- The `get_tool_result` tool lets the model re-read when needed. In practice, this is rare — the model has already processed the output and formed its plan.
- Combined with E1 (prompt caching), compacted messages change the content of early messages which would break cache prefix matching. **Compaction should only replace messages that are outside the cached prefix.** Implementation: only compact results from steps older than `currentStep - 2`.
- Consider a total context budget check: if estimated tokens exceed 70% of the model's context window, trigger more aggressive compaction (lower threshold, compact more aggressively).

---

## E4: Subagent Model Routing & Configuration

**Status:** DONE
**Scope:** `apps/agent/src/tools/task.ts`, `apps/agent/src/models.ts`, settings surface

Currently, subagents inherit the parent's model and provider. This is wasteful — subagent tasks (file search, test execution, focused edits) are typically simpler and can be handled by cheaper models.

### Design

**Three layers of model selection for subagents:**

1. **Default:** Subagents use a cheaper model than the parent. The default subagent model is configurable at the platform level (e.g., `SUBAGENT_DEFAULT_MODEL` env var). Sensible default: `anthropic/claude-haiku-4-5` or `openai/gpt-4.1-mini`.

2. **Settings:** Users can configure their preferred subagent model in settings (per-user or per-org). This overrides the platform default.

3. **Per-call override:** The parent agent can request a specific model for a subagent via the `task` tool's input schema:
   ```typescript
   const taskInputSchema = z.object({
     task: z.string().describe("Description of the task for the subagent"),
     context: z.string().optional().describe("Additional context the subagent needs"),
     model: z.string().optional().describe(
       "Model ID to use for this subagent (e.g. 'anthropic/claude-haiku-4-5'). "
       + "Defaults to the configured subagent model. Use a stronger model for complex reasoning tasks."
     ),
   });
   ```

### Resolution order

```
per-call model (from tool input) → user/org setting → platform default → parent model (fallback)
```

### Implementation

1. **Extend `task` tool input schema** with optional `model` field. Validate against available models.

2. **Add `subagentModel` to settings surface:**
   - DB: Add `subagent_model_id` column to user settings or org settings table.
   - Gateway: Expose via settings API.
   - Web: Add model selector in settings UI.
   - Pass resolved subagent model preference through the job payload to the agent.

3. **Resolve model in `taskTool`:** Accept a `resolveSubagentModel(requestedModel?: string)` function that implements the resolution chain. If the resolved model requires a different provider, create the appropriate provider instance.

4. **Multi-provider support:** The `taskTool` currently receives a single `provider` and `modelId`. Refactor to accept a model resolver that can return a different provider+model pair:
   ```typescript
   interface SubagentModelResolver {
     resolve(requestedModelId?: string): {
       provider: LLMProvider;
       modelId: string;
       providerName: "anthropic" | "openai";
     };
   }
   ```

5. **Usage tracking:** Subagent token usage should be attributed separately in `usage_events` (with a `parentRunId` reference) so cost dashboards can show parent vs subagent breakdown.

### Design notes

- The user asking the agent to "use Claude Opus for this subtask" is a natural interaction — the `model` parameter in the tool schema enables it.
- Cost-guard (R3) should validate the requested model against the user's budget before the subagent starts.
- Cheaper models may have smaller context windows — subagents already have minimal system prompts and fresh context, so this is usually fine.

---

## E5: Model Routing & Tiered Intelligence — STRATEGY NEEDED

**Status:** STRATEGY DESIGN — not ready for implementation
**Scope:** `apps/agent/src/loop.ts`, `apps/agent/src/models.ts`

The idea: not every step in the agent loop needs the most expensive model. Simple tool-dispatch steps (read a file, run grep, execute a test) could use a cheaper model, reserving the expensive model for reasoning-heavy steps.

### Open questions to resolve before implementation

1. **Step classification:** How do we determine which steps are "simple" vs "complex"?
   - Heuristic: if the previous response was purely tool calls (no text reasoning), the next step is likely a continuation that a cheaper model can handle.
   - Pattern-based: certain tool sequences (read → read → read) are exploratory and don't need strong reasoning.
   - Token-budget based: if remaining context budget is large relative to the task, use a cheaper model.
   - Explicit: the agent could emit a "complexity hint" that drives model selection.

2. **Quality risk:** Cheaper models may make worse tool-calling decisions, leading to more total steps and potentially higher cost than using one expensive model throughout.
   - Mitigation: only route to cheaper models for well-understood patterns (sequential file reads, running tests).
   - Mitigation: track step count and cost by routing strategy to measure actual savings.

3. **Implementation complexity:** Mid-loop model switching requires creating new provider instances and handling different response formats within the same turn.

4. **Interaction with caching (E1):** Switching models mid-loop breaks Anthropic prompt cache (different model = different cache key). This could negate caching savings.
   - Possible approach: use tiered routing only across turns, not within a turn.

5. **User control:** Should users be able to opt in/out of tiered routing? Should it be transparent or invisible?

### Recommended next step

Run a cost analysis on 20–50 real sessions using R3/R4 instrumentation data. Identify what percentage of steps are "simple tool dispatch" vs "reasoning-heavy." If >50% of steps are simple, tiered routing has significant potential. If most steps require reasoning, the complexity isn't worth it.

**Do not implement until E1–E4 are complete and instrumented.** Those provide the data needed to make an informed decision here.

---

## Dependency Graph

```
E1 (Prompt Caching) — no dependencies, immediate win
├── E3 (Tool Result Compaction) — complements E1, coordinate cache boundaries
│
E2 (Skills as Tools) — no dependencies, immediate win
│
E4 (Subagent Model Routing) — needs settings surface (minor UI work)
│
E5 (Model Routing Strategy) — blocked on instrumentation data from R3/R4 + E1–E4
```

**Recommended order:**

1. **E1** — Prompt caching (biggest single savings, lowest risk)
2. **E2** — Skills as tools (second biggest savings, straightforward)
3. **E3** — Tool result compaction (prevents runaway costs, stability)
4. **E4** — Subagent model routing (moderate savings, clean design)
5. **E5** — Tiered intelligence (data-driven decision after E1–E4 + R3/R4)

---

## Relationship to Other Refactors

| Refactor | Relationship |
|----------|-------------|
| **R3 (Cost Control)** | R3 instruments and enforces budgets. E1–E5 reduce the spend that hits those budgets. E1 adds cache metrics to instrument. E4 adds subagent cost attribution. |
| **R4 (Observability)** | E1 cache hit/miss rates, E3 compaction stats, E4 model routing decisions — all feed into observability tables. |
| **R1 (Own LLM Layer)** | Complete. E1–E3 build directly on the owned provider adapters. |
| **R8 (Tests)** | E1–E4 each need test coverage: cache header injection, skill index generation, compaction logic, model resolution chain. |
