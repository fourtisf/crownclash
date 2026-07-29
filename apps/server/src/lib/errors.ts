/**
 * One error shape for the whole API.
 *
 * The client branches on `error` codes from `API_ERRORS` in `@crown/shared`; anything else it
 * treats as a generic failure (see `api.ts`). `message` is for humans reading logs and dev
 * consoles — never for the client to parse.
 */
import type { FastifyReply } from 'fastify';
import { API_ERRORS, type ApiError } from '@crown/shared';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly retryAfter?: number,
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
}

export const unauthorized = (msg?: string): HttpError => new HttpError(401, API_ERRORS.unauthorized, msg);
export const badRequest = (code: string, msg?: string): HttpError => new HttpError(400, code, msg);
export const conflict = (code: string, msg?: string): HttpError => new HttpError(409, code, msg);
export const notFound = (code: string, msg?: string): HttpError => new HttpError(404, code, msg);

export function sendError(reply: FastifyReply, err: HttpError): FastifyReply {
  const body: ApiError = { error: err.code, message: err.message };
  if (err.retryAfter !== undefined) body.retryAfter = err.retryAfter;
  return reply.status(err.status).send(body);
}

/** Codes this server invents beyond `API_ERRORS`. Kept together so the client team can see them. */
export const SERVER_ERRORS = {
  badRequest: 'bad_request',
  alreadyMigrated: 'already_migrated',
  migrationRefused: 'migration_refused',
  invalidDeck: 'invalid_deck',
  invalidProfile: 'invalid_profile',
  unknownShopItem: 'unknown_shop_item',
  unsupportedChestSource: 'unsupported_chest_source',
  /** The save was written by another in-flight request; the client may retry verbatim. */
  saveConflict: 'save_conflict',
  internal: 'internal_error',
} as const;
