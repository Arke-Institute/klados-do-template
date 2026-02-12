# CLAUDE.md

Development guide for the Klados DO Template.

## Overview

This is a **Tier 2 klados worker template** using Cloudflare Durable Objects for long-running job processing. Use this when processing exceeds the 30-second `waitUntil()` limit of basic workers.

## Commands

```bash
npm run dev          # Local development (wrangler dev)
npm run deploy       # Deploy to Cloudflare
npm run type-check   # TypeScript validation
npm run register     # Register to test network
npm run register:prod # Register to main network
npm test             # Run tests (if configured)
```

### Registration

```bash
ARKE_USER_KEY=uk_... npm run register        # test network
ARKE_USER_KEY=uk_... npm run register:prod   # main network
```

State saved to `.klados-state.json` (test) or `.klados-state.prod.json` (main).

### Secrets

```bash
wrangler secret put ARKE_AGENT_KEY  # Set agent API key (ak_...)
```

## Architecture

### Request Flow

1. Arke sends `POST /process` with `KladosRequest`
2. Worker creates DO instance keyed by `job_id`
3. DO stores state in SQLite, schedules alarm
4. Worker returns `{ accepted: true }` immediately
5. Alarm fires, DO runs `processJob()`
6. On completion, DO writes log and handles handoffs

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Thin dispatcher - routes to DO |
| `src/job-do.ts` | Durable Object - state management, lifecycle |
| `src/job.ts` | **Customize this** - your business logic |
| `src/types.ts` | **Customize this** - your entity types |

### State Machine

```
accepted → processing → done
                     → error
```

With reschedule:
```
accepted → processing → (reschedule) → processing → done
```

## Customization Points

### 1. Business Logic (`src/job.ts`)

The `processJob` function is where your logic goes:

```typescript
export async function processJob(ctx: ProcessContext): Promise<ProcessResult> {
  const { request, client, logger, sql, env } = ctx;

  // Your processing here
  // Access secrets/vars via env (e.g., env.GEMINI_API_KEY)

  return {
    outputs: [entityId],      // Entity IDs for workflow handoff
    reschedule?: boolean,     // Set true to continue in next alarm
  };
}
```

### 2. Type Definitions (`src/types.ts`)

Define your input/output entity properties:

```typescript
export interface TargetProperties {
  // Properties of entities you receive
}

export interface OutputProperties {
  // Properties of entities you create
}
```

### 3. Wrangler Config (`wrangler.jsonc`)

Update worker name and environment variables:

```jsonc
{
  "name": "my-klados-name",
  "vars": {
    "AGENT_ID": "your-klados-id",
    "AGENT_VERSION": "1.0.0"
  }
}
```

## Key Patterns

### Checkpointing for Long Operations

Use `sql` parameter to save progress:

```typescript
// Save progress
sql.exec('UPDATE progress SET current_index = ? WHERE id = 1', index);

// Reschedule to continue
return { reschedule: true };
```

### Creating Output Entities

Always use `target_collection`, not `job_collection`:

```typescript
// CORRECT
collection: request.target_collection

// WRONG - job_collection is only for klados_log entities
collection: request.job_collection
```

### Workflow Handoffs

Return entity IDs in `outputs` array:

```typescript
return {
  outputs: [entity1.id, entity2.id],  // These get passed to next step
};
```

For scatter operations, return multiple IDs. The DO handles `interpretThen` automatically.

## Cloudflare Limits

| Resource | Limit |
|----------|-------|
| Alarm tick | ~30 seconds (reschedule for longer) |
| SQL row size | 2MB |
| SQL total storage | 10GB per DO |
| Memory | 128MB |
| Sub-requests | Effectively unlimited with rescheduling |

## Debugging

### Wrangler Logs

**Must run BEFORE triggering your worker:**

```bash
wrangler tail
```

Historical logs are not available via `wrangler tail`.

### Check DO State

The DO exposes `/status`:

```bash
curl https://your-worker.workers.dev/status?job_id=xxx
```

### Common Issues

1. **"waitUntil tasks did not complete"** - You're using basic worker pattern, switch to DO
2. **Job stuck in "processing"** - Check for infinite loops, add reschedule exit conditions
3. **Handoffs not working** - Verify rhiza flow configuration matches step names
4. **Log not created** - Check `job_collection` permissions

## Testing

### Local Development

```bash
npm run dev
```

Note: DOs work locally but SQL state resets on restart.

### E2E Testing

Use `@arke-institute/klados-testing`:

```typescript
import { waitForWorkflowTree } from '@arke-institute/klados-testing';

// Use tree traversal (no indexing lag)
const tree = await waitForWorkflowTree(jobCollectionId, {
  timeout: 120000,
  pollInterval: 3000,
});
```

## DO Lifecycle

- **Creation**: One DO instance per `job_id` (deterministic via `idFromName`)
- **Persistence**: State persists in SQL until explicitly deleted
- **Cleanup**: On success, state remains (for debugging). Consider adding cleanup for production.
- **Error handling**: Errors stored in `job_state.error` column

## Rhiza Integration

The DO handles rhiza workflow integration automatically:

1. Writes initial `klados_log` entity
2. Executes `interpretThen` for workflow handoffs
3. Updates log with handoff records
4. Marks log as `done` or `error`

Flow steps are defined in the rhiza entity's `properties.flow` object.

## Migration from Tier 1

If migrating from basic worker template:

1. Move processing logic from inline handler to `processJob()`
2. Replace `waitUntil()` pattern with alarm-based processing
3. Add state persistence for long operations
4. Update wrangler.jsonc with DO bindings

The DO template handles log writing and handoffs the same way as `KladosJob` from rhiza.
