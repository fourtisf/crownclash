/**
 * Telemetry intake.
 *
 * Events land in the structured log stream rather than a database table. That is a deliberate
 * trade: a table would need a migration for every new question, would grow without bound, and
 * would tempt someone to query it from a request path. Structured logs ship to whatever
 * analytics or warehouse tool is chosen later, and cost nothing until then.
 *
 * Nothing here is trusted and nothing is read back into the game. Telemetry is evidence about
 * players, never state belonging to them — a client that lies only pollutes its own numbers.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS, limit } from '../lib/ratelimit.js';

/** Caps chosen so one malicious client cannot flood the log pipeline. */
const MAX_EVENTS = 40;
const MAX_NAME = 48;
const MAX_PROPS = 16;
const MAX_STRING = 240;

const scalar = z.union([z.string().max(MAX_STRING), z.number().finite(), z.boolean(), z.null()]);

const schema = z.object({
  session: z.string().min(1).max(64),
  events: z
    .array(
      z.object({
        name: z.string().min(1).max(MAX_NAME),
        t: z.number().int().nonnegative(),
        props: z.record(scalar).optional(),
      }),
    )
    .min(1)
    .max(MAX_EVENTS),
});

export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/telemetry', { config: limit(LIMITS.telemetry) }, async (req, reply) => {
    const parsed = schema.safeParse(req.body);
    // A malformed batch is dropped silently with a 204. Telemetry must never surface an error
    // to a player, and never cost the client a retry loop over data nobody is waiting for.
    if (!parsed.success) {
      reply.code(204);
      return null;
    }
    const { events, session } = parsed.data;
    // `resolveSession` has already turned the cookie into an id (or null) with no DB hit.
    const userId = req.userId ?? null;

    for (const e of events) {
      const props = e.props ? Object.fromEntries(Object.entries(e.props).slice(0, MAX_PROPS)) : undefined;
      // One line per event, on a dedicated `evt` key so a log shipper can filter cheaply.
      req.log.info({ evt: e.name, session, userId: userId ?? null, at: e.t, ...props }, 'telemetry');
    }
    reply.code(204);
    return null;
  });
}
