# OC-Builder Service

Nest backend for OC-Builder's traditional server responsibilities.

The agent stays responsible for intelligence: understanding, planning, generation, and tool use.
This service owns data: identity, conversations, events, memories, promises, reflections, retrieval logs, transactions, and migrations.

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm start:dev
```

Default API: `http://127.0.0.1:3001`.

From the repository root:

```bash
pnpm service:migrate
pnpm service:dev
```

## Boundary

- Put deterministic data operations here.
- Keep LLM calls, personality decisions, prompt assembly, and reply generation in the agent.
- The agent should call this service through APIs instead of reading or writing durable memory directly.
