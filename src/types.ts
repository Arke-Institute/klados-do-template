/**
 * Type definitions for the klados DO worker
 */

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  /** Klados agent ID (registered in Arke) */
  AGENT_ID: string;

  /** Agent version for logging */
  AGENT_VERSION: string;

  /** Arke agent API key (secret) */
  ARKE_AGENT_KEY: string;

  /** Verification token for endpoint verification (set during registration) */
  VERIFICATION_TOKEN?: string;

  /** Agent ID for verification (used before AGENT_ID is configured) */
  ARKE_VERIFY_AGENT_ID?: string;

  /** Durable Object binding for job processing */
  KLADOS_JOB: DurableObjectNamespace;
}

/**
 * Example: Properties of the target entity being processed
 *
 * Customize this based on what your worker processes.
 */
export interface TargetProperties {
  /** Example: title of the entity */
  title?: string;

  /** Example: content to process */
  content?: string;

  /** Example: URL to fetch */
  url?: string;

  /** Allow any additional properties */
  [key: string]: unknown;
}

/**
 * Example: Properties for output entities created by this worker
 *
 * Customize this based on what your worker produces.
 */
export interface OutputProperties {
  /** Example: processed result */
  result?: string;

  /** Example: extracted data */
  extracted?: Record<string, unknown>;

  /** Reference to source entity */
  source_id?: string;

  /** Processing timestamp */
  processed_at?: string;

  /** Allow any additional properties */
  [key: string]: unknown;
}
