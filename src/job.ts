/**
 * Job Processing Logic
 *
 * This file contains the main business logic for processing jobs.
 * Customize the processJob function to implement your worker's behavior.
 *
 * Unlike Tier 1 workers, this can take arbitrarily long (via alarm rescheduling).
 * For very long operations, you can:
 * 1. Check elapsed time
 * 2. Save progress to DO state via sql
 * 3. Return { reschedule: true }
 * 4. Alarm fires again, resumes from saved progress
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type { KladosLogger, KladosRequest, Output } from '@arke-institute/rhiza';
import type { Env, TargetProperties, OutputProperties } from './types';

/**
 * Context provided to processJob
 */
export interface ProcessContext {
  /** The original request */
  request: KladosRequest;

  /** Arke client for API calls */
  client: ArkeClient;

  /** Logger for messages (stored in the klados_log) */
  logger: KladosLogger;

  /** SQLite storage for checkpointing long operations */
  sql: SqlStorage;

  /** Worker environment bindings (secrets, vars, DO namespaces) */
  env: Env;
}

/**
 * Result returned from processJob
 */
export interface ProcessResult {
  /** Output entity IDs (or OutputItems with routing properties) */
  outputs?: Output[];

  /** If true, DO will reschedule alarm and call processJob again */
  reschedule?: boolean;
}

/**
 * Process a job and return output entity IDs
 *
 * This is where you implement your worker's core logic:
 * 1. Fetch and validate the target entity
 * 2. Process the entity (AI calls, transformations, etc.)
 * 3. Create output entities
 * 4. Return the output entity IDs
 *
 * For long-running operations:
 * - Use sql.exec() to checkpoint progress
 * - Return { reschedule: true } to continue in next alarm
 * - Check elapsed time to avoid running too long in one tick
 *
 * @param ctx - Processing context (request, client, logger, sql)
 * @returns Result with outputs and optional reschedule flag
 */
export async function processJob(ctx: ProcessContext): Promise<ProcessResult> {
  const { request, client, logger, sql } = ctx;

  logger.info('Starting job processing', {
    target: request.target_entity,
    isWorkflow: !!request.rhiza,
  });

  // =========================================================================
  // Step 1: Fetch the target entity
  // =========================================================================

  if (!request.target_entity) {
    throw new Error('No target_entity in request');
  }

  const { data: target, error: fetchError } = await client.api.GET('/entities/{id}', {
    params: { path: { id: request.target_entity } },
  });

  if (fetchError || !target) {
    throw new Error(`Failed to fetch target: ${request.target_entity}`);
  }

  const properties = target.properties as TargetProperties;

  logger.info('Fetched target entity', {
    id: target.id,
    type: target.type,
    title: properties.title,
  });

  // =========================================================================
  // Step 2: Validate the target (optional but recommended)
  // =========================================================================

  // Example validation - customize for your use case
  // if (!properties.content) {
  //   throw new Error('Target entity must have content property');
  // }

  // =========================================================================
  // Step 3: Process the entity
  // =========================================================================

  // Replace this with your actual processing logic:
  // - AI/LLM calls
  // - Data transformation
  // - External API calls
  // - Lambda polling
  // - etc.

  logger.info('Processing entity...');

  // Example: Simple processing
  const result = await processEntity(target.id, properties);

  // =========================================================================
  // Example: Long-running operation with checkpointing
  // =========================================================================
  //
  // Uncomment and adapt this pattern for multi-minute operations:
  //
  // // Create progress table if needed
  // sql.exec(`
  //   CREATE TABLE IF NOT EXISTS job_progress (
  //     id INTEGER PRIMARY KEY,
  //     current_index INTEGER NOT NULL DEFAULT 0,
  //     total_items INTEGER NOT NULL,
  //     started_at TEXT NOT NULL
  //   )
  // `);
  //
  // // Check for existing progress
  // const progress = sql.exec('SELECT * FROM job_progress WHERE id = 1').one();
  // const startIndex = progress ? (progress.current_index as number) : 0;
  // const totalItems = progress ? (progress.total_items as number) : 1000;
  //
  // if (!progress) {
  //   sql.exec(
  //     'INSERT INTO job_progress (id, current_index, total_items, started_at) VALUES (1, 0, ?, ?)',
  //     1000,
  //     new Date().toISOString()
  //   );
  // }
  //
  // const startTime = Date.now();
  // const MAX_TICK_MS = 25000; // Leave buffer before 30s limit
  //
  // for (let i = startIndex; i < totalItems; i++) {
  //   // Process item i...
  //   await processItem(i);
  //
  //   // Checkpoint every 100 items
  //   if (i % 100 === 0) {
  //     sql.exec('UPDATE job_progress SET current_index = ? WHERE id = 1', i);
  //     logger.info(`Progress: ${i}/${totalItems}`);
  //   }
  //
  //   // Reschedule if running too long
  //   if (Date.now() - startTime > MAX_TICK_MS) {
  //     sql.exec('UPDATE job_progress SET current_index = ? WHERE id = 1', i);
  //     logger.info(`Rescheduling at ${i}/${totalItems}`);
  //     return { reschedule: true };
  //   }
  // }
  //
  // // Clear progress on completion
  // sql.exec('DELETE FROM job_progress WHERE id = 1');

  logger.info('Processing complete', {
    resultLength: result.length,
  });

  // =========================================================================
  // Step 4: Create output entity
  // =========================================================================

  const outputProperties: OutputProperties = {
    result,
    source_id: target.id,
    processed_at: new Date().toISOString(),
  };

  // Create output in target_collection (where work happens)
  // NOT job_collection (which is only for klados_log entities)
  const { data: output, error: createError } = await client.api.POST('/entities', {
    body: {
      type: 'processed_output', // Customize the output type
      collection: request.target_collection,
      properties: outputProperties as Record<string, unknown>,
      relationships: [
        {
          predicate: 'derived_from',
          peer: target.id,
          peer_type: target.type,
        },
      ],
    },
  });

  if (createError || !output) {
    throw new Error(`Failed to create output entity: ${JSON.stringify(createError)}`);
  }

  logger.success('Created output entity', { outputId: output.id });

  // =========================================================================
  // Step 5: Return output IDs for workflow handoff
  // =========================================================================

  // The DO will use these IDs for the next step in the workflow
  // (pass, scatter, or gather depending on your rhiza flow definition)
  return {
    outputs: [output.id],
  };
}

/**
 * Example processing function - replace with your actual logic
 *
 * @param entityId - The entity ID being processed
 * @param properties - The entity properties
 * @returns Processed result
 */
async function processEntity(
  entityId: string,
  properties: TargetProperties
): Promise<string> {
  // Example: Simple echo processing
  // Replace this with your actual processing logic

  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Return a processed result
  return `Processed entity ${entityId}: ${properties.title || 'untitled'}`;
}
