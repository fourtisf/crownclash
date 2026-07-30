/**
 * Prisma client singleton.
 *
 * ## Why the client is typed by hand here
 *
 * `prisma/schema.prisma` lives at the monorepo root, so the CLI resolves `@prisma/client`
 * from there; it is now a root devDependency and `prisma generate` succeeds. What stays
 * hand-written is the *type* surface: the delegate shapes the store uses are declared
 * structurally below and the real client is loaded through a runtime import.
 *
 * That keeps typecheck, tests and CI working on a clean checkout, where nobody has run
 * `prisma generate` yet and the generated types do not exist. A static
 * `import { PrismaClient } from '@prisma/client'` would make the whole server
 * un-typecheckable until a database-adjacent codegen step had run — a bad trade for a
 * four-model schema whose query arguments are all built in one file (`store-prisma.ts`).
 *
 * The cost is that arguments are checked against the shapes here rather than generated model
 * types, so this file and the schema must be kept in step by hand. Swapping to the generated
 * types is a safe follow-up once codegen is wired into the install step.
 */
import { env } from './env.js';
import { logger } from './logger.js';

/** Prisma's filter/`where` objects — arbitrarily nested operator maps. */
export type PrismaWhere = Record<string, unknown>;
export type PrismaData = Record<string, unknown>;

export interface PrismaDelegate<Row> {
  findUnique(args: { where: PrismaWhere; select?: Record<string, boolean> }): Promise<Row | null>;
  findFirst(args: { where?: PrismaWhere; orderBy?: unknown; select?: Record<string, boolean> }): Promise<Row | null>;
  findMany(args?: {
    where?: PrismaWhere;
    orderBy?: unknown;
    take?: number;
    skip?: number;
    select?: Record<string, boolean>;
  }): Promise<Row[]>;
  create(args: { data: PrismaData; select?: Record<string, boolean> }): Promise<Row>;
  update(args: { where: PrismaWhere; data: PrismaData }): Promise<Row>;
  updateMany(args: { where: PrismaWhere; data: PrismaData }): Promise<{ count: number }>;
  upsert(args: { where: PrismaWhere; create: PrismaData; update: PrismaData }): Promise<Row>;
  count(args?: { where?: PrismaWhere }): Promise<number>;
  deleteMany(args?: { where?: PrismaWhere }): Promise<{ count: number }>;
}

/** Row shapes exactly as `prisma/schema.prisma` declares them. */
export interface DbUser {
  id: string;
  deviceId: string;
  wallet: string | null;
  walletKind: string | null;
  airdropEligible: boolean;
  recoveryHash: string | null;
  recoveryAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface DbSave {
  id: string;
  userId: string;
  json: unknown;
  trophies: number;
  best: number;
  migrated: boolean;
  migratedAt: Date | null;
  sanitizeFlags: string[];
  updatedAt: Date;
  version: number;
}

export interface DbMatch {
  id: string;
  userId: string;
  seed: string;
  mode: string;
  config: unknown;
  aiDeck: unknown;
  aiLevel: number;
  arenaIndex: number;
  opponent: unknown;
  deployLog: unknown;
  result: string | null;
  crowns: unknown;
  validated: boolean;
  voidReason: string | null;
  resultHash: string | null;
  rewardSeed: string | null;
  trophyDelta: number | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface DbWalletNonce {
  nonce: string;
  address: string;
  kind: string;
  message: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/** The delegates a transaction callback gets. Same surface, minus connection management. */
export type PrismaTx = Omit<PrismaLike, '$disconnect' | '$transaction'>;

export interface PrismaLike {
  user: PrismaDelegate<DbUser>;
  save: PrismaDelegate<DbSave>;
  match: PrismaDelegate<DbMatch>;
  walletNonce: PrismaDelegate<DbWalletNonce>;
  /**
   * Interactive transaction. Needed by `adoptDevice`, where a unique device id has to move
   * between two rows — the release and the claim are not separable without either violating
   * the constraint or leaving the device owned by nobody.
   */
  $transaction<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
}

interface PrismaModule {
  PrismaClient: new (opts?: { datasources?: { db: { url: string } }; log?: string[] }) => PrismaLike;
}

let client: PrismaLike | null = null;

/**
 * Lazy singleton. Lazy on purpose: importing this module must not open a connection, or the
 * test suite (which never touches Postgres) would fail on a machine without a database.
 */
export async function getPrisma(): Promise<PrismaLike> {
  if (client) return client;
  // Indirect specifier: the generated client does not exist until `prisma generate` runs, and
  // a static import would make `tsc --noEmit` fail on a fresh clone.
  const specifier = '@prisma/client';
  const mod = (await import(specifier)) as PrismaModule;
  client = new mod.PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
  logger.info('prisma client initialised');
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = null;
}

/** Prisma's unique-constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
