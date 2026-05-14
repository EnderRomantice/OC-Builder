# OC-Builder

Universal virtual persona builder for WeChat and QQ ecosystems.

中文文档: [README.zh-CN.md](README.zh-CN.md)

## Vision

OC-Builder is not only a chat bot. The long-term goal is to run believable virtual characters that live inside social platforms: they talk, remember, browse timelines, react to posts, maintain relationships, and act with a consistent soul.

## Current Scope

- WeChat private and group chat via Wechaty.
- DeepSeek-compatible OpenAI SDK client.
- Per-contact profile, chat history, and task files.
- Social decision phase before action execution.
- Tool loop for search, shell execution, task completion, and WeChat contact actions.
- Message splitting for natural WeChat bubbles.

## Target Architecture

```text
Platform Adapters
  WeChat Adapter
  QQ Adapter
  Timeline Adapter

Event Runtime
  Event Inbox
  Conversation Scheduler
  Context Builder

Character Runtime
  Social Decision
  Agent Loop
  Action Dispatcher
  Memory Writer

Character Model
  Soul
  Behavior Policy
  Relationship Policy
  Memory Write Policy

Memory and Storage
  Contact Memory
  Account Memory
  Relationship Memory
  Event History
  Task and Promise Ledger
```

Platform adapters convert WeChat, QQ, Moments, and QZone activity into normalized `SocialEvent` objects. The character runtime consumes normalized events and returns normalized actions, so the persona core is not tied to a specific platform SDK.

## Runtime Model

The preferred production model is one character per process, managed by a supervisor later.

Reasons:

- Strong isolation between souls, platform login states, memory, and tools.
- Easier debugging and observability.
- Lower risk of context leakage between characters.
- Natural fit for real social accounts.

## Memory Policy

OC-Builder should not rely on vector databases for critical facts. Relationship memory must be keyed deterministically by character, platform, account, and contact. A wrong memory is more damaging than a missing memory.

Recommended future storage:

- SQLite for local development.
- PostgreSQL for long-running multi-character deployments.
- Audit logs for all memory writes.
- Optional full-text search for non-critical recall.

## Quick Start

1. Configure environment:

   Copy `.env.example` to `.env` and set `DEEPSEEK_API_KEY` and `SEARXNG_URL`.

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build:

   ```bash
   pnpm build
   ```

4. Start:

   ```bash
   pnpm start
   ```

## Contributors

- Ender (Project Lead)
