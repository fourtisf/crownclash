/**
 * Runtime configuration.
 *
 * Every value has a dev default so `pnpm dev` starts with an empty environment — the only
 * things it genuinely needs are Postgres (for the Prisma store) and nothing else. Redis is
 * optional by design (see `redis.ts`).
 *
 * The dev secrets are deliberately obvious placeholders AND deliberately rejected in
 * production: shipping with a default JWT key is the single cheapest way to hand out
 * everyone's account, so the process refuses to boot rather than warn.
 */
import { z } from 'zod';

/** Sentinel values. If either of these reaches production the process exits. */
export const DEV_AUTH_SECRET = 'dev-only-auth-secret-change-me-32ch';
export const DEV_COOKIE_SECRET = 'dev-only-cookie-secret-change-me';

const csv = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v === '1' || v.toLowerCase() === 'true'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().default('postgresql://crown:crown@localhost:5432/crown?schema=public'),
  /** Unset ⇒ the in-memory fallback in `redis.ts`. Never unset in production. */
  REDIS_URL: z.string().optional(),

  AUTH_SECRET: z.string().min(16).default(DEV_AUTH_SECRET),
  COOKIE_SECRET: z.string().min(16).default(DEV_COOKIE_SECRET),
  COOKIE_NAME: z.string().default('cc_session'),
  COOKIE_DOMAIN: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** Browser origins allowed to send the session cookie. Credentials mode needs exact hosts. */
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:4173').transform(csv),

  /** SIWE binding. `SIWE_DOMAIN` must equal the host the client page is served from. */
  SIWE_DOMAIN: z.string().default('localhost:5173'),
  SIWE_URI: z.string().default('http://localhost:5173'),
  SIWE_CHAIN_ID: z.coerce.number().int().default(1),
  SIWE_STATEMENT: z.string().default('Link this wallet to your Crown Clash account.'),
  WALLET_NONCE_TTL_SEC: z.coerce.number().int().min(30).max(3600).default(300),

  RATE_LIMIT_ENABLED: bool.default(true),
  /** Behind nginx/Cloudflare the real client IP arrives in X-Forwarded-For. */
  TRUST_PROXY: bool.default(true),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Worker cadence and the age at which an unfinished match is written off. */
  WORKER_TICK_MS: z.coerce.number().int().min(1000).default(15_000),
  MATCH_EXPIRY_MINUTES: z.coerce.number().int().min(1).default(15),
  LEADERBOARD_TTL_SEC: z.coerce.number().int().min(1).default(30),

  /** Optional: serve the built client from the API process (single-VPS deployments). */
  STATIC_DIR: z.string().optional(),

  /** Largest match-finish body we will parse. A legal deploy log is ~15 KB at worst. */
  BODY_LIMIT_BYTES: z.coerce.number().int().min(16_384).default(262_144),
});

export type Env = z.infer<typeof schema>;

function load(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${detail}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.AUTH_SECRET === DEV_AUTH_SECRET) throw new Error('AUTH_SECRET is still the dev default; refusing to start in production');
    if (env.COOKIE_SECRET === DEV_COOKIE_SECRET) throw new Error('COOKIE_SECRET is still the dev default; refusing to start in production');
  }
  return env;
}

export const env: Env = load();

/** Exposed for tests, which build throwaway configs without touching `process.env`. */
export const loadEnv = load;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
