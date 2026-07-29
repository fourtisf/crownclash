/**
 * @crown/shared — the game.
 *
 * Pure TypeScript, zero DOM, zero Node built-ins. The browser client and the Fastify server
 * both import this package, so there is exactly one implementation of the rules and the
 * server's re-simulation cannot disagree with what the player saw.
 */
export * from './types.js';
export * from './rng.js';
export * from './util.js';
export * from './data.js';
export * from './state.js';
export * from './sim.js';
export * from './ai.js';
export * from './economy.js';
export * from './validate.js';
