# Klados DO Template

A Cloudflare Durable Object template for long-running Arke workflow jobs. Use this when your processing exceeds Cloudflare Workers' 30-second `waitUntil()` limit.

## When to Use This Template

| Scenario | Use Basic Template | Use DO Template |
|----------|-------------------|-----------------|
| Processing time | < 30 seconds | > 30 seconds |
| Sub-requests | < 1000 | > 1000 |
| LLM API calls | 1-2 quick calls | Multiple/slow calls |
| Batch entity creation | < 50 entities | > 50 entities |
| External polling | Not needed | Lambda, webhooks |
| State persistence | Not needed | Checkpointing required |

### Cloudflare Limits Explained

**Basic Workers (Tier 1):**
- `waitUntil()` has a **fixed 30-second limit** after response is sent
- Maximum 1000 sub-requests per invocation
- 128MB memory limit

**Durable Objects (Tier 2):**
- **No time limit** - process indefinitely via alarm rescheduling
- 10GB SQL storage per DO
- 2MB per SQL row
- Can checkpoint progress and resume

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/Arke-Institute/klados-do-template my-klados
cd my-klados
npm install
```

### 2. Configure

Update `wrangler.jsonc`:
```jsonc
{
  "name": "my-klados-worker",
  "vars": {
    "AGENT_ID": "your-klados-agent-id",
    "AGENT_VERSION": "0.1.0"
  }
}
```

### 3. Register with Arke

```bash
# Create .env file
echo "ARKE_USER_KEY=uk_your_key_here" > .env

# Register to test network
npm run register

# Or register to main network
npm run register:prod
```

### 4. Set Secrets

```bash
wrangler secret put ARKE_AGENT_KEY
# Enter your agent key (ak_...)
```

### 5. Implement Your Logic

Edit `src/job.ts` to implement your processing logic:

```typescript
export async function processJob(ctx: ProcessContext): Promise<ProcessResult> {
  const { request, client, logger, sql } = ctx;

  // Your processing logic here
  // ...

  return {
    outputs: [outputEntityId],
  };
}
```

### 6. Deploy

```bash
npm run deploy
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  /process endpoint                                   │    │
│  │  - Receives KladosRequest from Arke                 │    │
│  │  - Creates DO instance (keyed by job_id)            │    │
│  │  - Returns acceptance immediately                    │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  KladosJobDO (Durable Object)                       │    │
│  │  - Stores job state in SQLite                       │    │
│  │  - Processes via alarm (no time limit)              │    │
│  │  - Handles workflow handoffs                        │    │
│  │  - Supports reschedule for very long operations     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Customization Guide

### Basic Processing

For simple long-running jobs, implement `processJob` in `src/job.ts`:

```typescript
export async function processJob(ctx: ProcessContext): Promise<ProcessResult> {
  const { request, client, logger, env } = ctx;

  // Fetch target entity
  const { data: target } = await client.api.GET('/entities/{id}', {
    params: { path: { id: request.target_entity! } },
  });

  // Process (e.g., LLM call)
  const result = await callLLM(target.properties.content);

  // Create output entity
  const { data: output } = await client.api.POST('/entities', {
    body: {
      type: 'processed_output',
      collection: request.target_collection,
      properties: { result },
    },
  });

  return { outputs: [output.id] };
}
```

### Long-Running with Checkpointing

For operations that may exceed a single alarm tick (use when processing 100+ items):

```typescript
export async function processJob(ctx: ProcessContext): Promise<ProcessResult> {
  const { request, client, logger, sql, env } = ctx;

  // Initialize progress table
  sql.exec(`
    CREATE TABLE IF NOT EXISTS job_progress (
      id INTEGER PRIMARY KEY,
      current_index INTEGER NOT NULL DEFAULT 0,
      total_items INTEGER NOT NULL
    )
  `);

  // Check for existing progress
  const progress = sql.exec('SELECT * FROM job_progress WHERE id = 1').one();
  const startIndex = progress ? (progress.current_index as number) : 0;
  const items = await fetchItems(); // Your items to process

  if (!progress) {
    sql.exec('INSERT INTO job_progress (id, current_index, total_items) VALUES (1, 0, ?)', items.length);
  }

  const startTime = Date.now();
  const MAX_TICK_MS = 25000; // Leave buffer before 30s limit

  for (let i = startIndex; i < items.length; i++) {
    await processItem(items[i]);

    // Checkpoint every 50 items
    if (i % 50 === 0) {
      sql.exec('UPDATE job_progress SET current_index = ? WHERE id = 1', i);
      logger.info(`Progress: ${i}/${items.length}`);
    }

    // Reschedule if running too long
    if (Date.now() - startTime > MAX_TICK_MS) {
      sql.exec('UPDATE job_progress SET current_index = ? WHERE id = 1', i);
      return { reschedule: true };
    }
  }

  // Clean up on completion
  sql.exec('DELETE FROM job_progress WHERE id = 1');

  return { outputs: createdEntityIds };
}
```

### Polling External Service

For Lambda functions or webhooks that need polling:

```typescript
export async function processJob(ctx: ProcessContext): Promise<ProcessResult> {
  const { request, client, logger, sql, env } = ctx;

  // Initialize state
  sql.exec(`
    CREATE TABLE IF NOT EXISTS poll_state (
      id INTEGER PRIMARY KEY,
      external_job_id TEXT,
      poll_count INTEGER DEFAULT 0
    )
  `);

  const state = sql.exec('SELECT * FROM poll_state WHERE id = 1').one();

  if (!state) {
    // First run - start external job
    const externalJobId = await startExternalJob(request);
    sql.exec('INSERT INTO poll_state (id, external_job_id) VALUES (1, ?)', externalJobId);
    return { reschedule: true }; // Check back in 1 second
  }

  // Poll for completion
  const result = await checkExternalJob(state.external_job_id as string);

  if (result.status === 'pending') {
    sql.exec('UPDATE poll_state SET poll_count = poll_count + 1 WHERE id = 1');
    logger.info(`Poll #${(state.poll_count as number) + 1}: still pending`);
    return { reschedule: true };
  }

  // Complete
  sql.exec('DELETE FROM poll_state WHERE id = 1');
  return { outputs: [result.outputId] };
}
```

## Type Definitions

Customize `src/types.ts` for your entity properties:

```typescript
// What your worker receives
export interface TargetProperties {
  title?: string;
  content?: string;
  url?: string;
  [key: string]: unknown;
}

// What your worker produces
export interface OutputProperties {
  result?: string;
  extracted?: Record<string, unknown>;
  source_id?: string;
  processed_at?: string;
  [key: string]: unknown;
}
```

## File Structure

```
klados-do-template/
├── src/
│   ├── index.ts      # Worker entry point (thin dispatcher)
│   ├── job-do.ts     # Durable Object implementation
│   ├── job.ts        # Your business logic (customize this)
│   └── types.ts      # Type definitions (customize this)
├── wrangler.jsonc    # Cloudflare configuration
├── package.json
└── tsconfig.json
```

## Debugging

### View Logs

```bash
# Must run BEFORE triggering your worker
wrangler tail
```

### Check Job Status

The DO exposes a `/status` endpoint:
```typescript
const doStub = env.KLADOS_JOB.get(env.KLADOS_JOB.idFromName(jobId));
const status = await doStub.fetch('https://do/status');
// Returns: { status: 'accepted' | 'processing' | 'done' | 'error', error?: string }
```

### Common Issues

1. **Job times out immediately** - Check that `processJob` returns a result, not `undefined`
2. **Handoffs not working** - Verify `outputs` array contains valid entity IDs
3. **State not persisting** - Ensure SQL queries use correct table names
4. **Reschedule loop** - Add exit condition to prevent infinite rescheduling

## License

MIT
