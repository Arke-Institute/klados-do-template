/**
 * Klados DO Worker - Durable Object template for long-running Arke workflows
 *
 * This template provides a Tier 2 klados worker that uses Durable Objects:
 * 1. Accepts job requests from Arke and returns immediately
 * 2. Hands off processing to a Durable Object
 * 3. DO uses alarms for processing (no 30s CPU limit)
 * 4. Supports checkpointing for very long operations
 *
 * Use this template when your processing needs:
 * - More than 30 seconds of CPU time
 * - More than 1000 sub-requests
 * - State persistence across multiple processing phases
 */

import { Hono } from 'hono';
import type { KladosRequest, KladosResponse } from '@arke-institute/rhiza';
import { KladosJobDO } from './job-do';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

/**
 * Health check endpoint
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    agent_id: c.env.AGENT_ID,
    version: c.env.AGENT_VERSION,
    tier: 2,
  });
});

/**
 * Arke verification endpoint
 * Required to verify ownership of this endpoint before activating the klados.
 * Returns the verification token provided during registration.
 *
 * Uses ARKE_VERIFY_AGENT_ID during initial verification (before AGENT_ID is set),
 * then falls back to AGENT_ID for subsequent verifications.
 */
app.get('/.well-known/arke-verification', (c) => {
  const token = c.env.VERIFICATION_TOKEN;
  // Use verification-specific agent ID if set, otherwise fall back to main AGENT_ID
  const kladosId = c.env.ARKE_VERIFY_AGENT_ID || c.env.AGENT_ID;

  if (!token || !kladosId) {
    return c.json({ error: 'Verification not configured' }, 500);
  }

  return c.json({
    verification_token: token,
    klados_id: kladosId,
  });
});

/**
 * Main job processing endpoint
 *
 * Unlike Tier 1, this hands off to a Durable Object instead of using waitUntil.
 * The DO schedules an alarm for immediate processing and can reschedule
 * for long-running operations.
 */
app.post('/process', async (c) => {
  const req = await c.req.json<KladosRequest>();

  // Get DO instance by job_id (deterministic - same job_id always gets same DO)
  const doId = c.env.KLADOS_JOB.idFromName(req.job_id);
  const doStub = c.env.KLADOS_JOB.get(doId);

  // Start the job in the DO
  const response = await doStub.fetch(
    new Request('https://do/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: req,
        config: {
          agentId: c.env.AGENT_ID,
          agentVersion: c.env.AGENT_VERSION,
          authToken: c.env.ARKE_AGENT_KEY,
        },
      }),
    })
  );

  return c.json(await response.json() as KladosResponse);
});

// Export the DO class (required for Cloudflare)
export { KladosJobDO };
export default app;
