/**
 * Vite config for the Crown Clash client.
 *
 * Two jobs: make `pnpm dev` run the web app and the API as one thing, and produce a build that
 * a mid-range phone can actually load — mobile is the primary target (handoff §6: 480px frame,
 * tested at 380×740), not a responsive afterthought.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * Where the dev proxy sends API traffic. Matches `PORT`'s default in
 * `apps/server/src/lib/env.ts`; override for a server running elsewhere.
 */
const API_TARGET = process.env.VITE_DEV_API ?? 'http://localhost:8080';

export default defineConfig({
  // Absolute base: index.html and every asset are served from the site root, and nginx's SPA
  // fallback serves index.html for arbitrary paths — relative asset URLs would resolve against
  // the wrong directory on any path but `/`.
  base: '/',

  resolve: {
    alias: {
      // Resolve the workspace package to its TypeScript source rather than through its
      // package.json `exports` (which points at `./src/index.ts` anyway). Explicit here so the
      // client build never depends on `packages/shared` having been compiled first, and so this
      // matches the alias vitest.config.ts already uses — one resolution rule for dev, test and
      // build means the sim the tests exercise is the sim that ships.
      '@crown/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },

  server: {
    // Bind on all interfaces so a real phone on the same wifi can open the dev server. §6 says
    // to test at 380×740 and a desktop emulator does not reproduce touch latency or the
    // safe-area insets the layout uses.
    host: true,
    port: 5173,
    // Fail loudly instead of silently moving to 5174: the server's CORS_ORIGIN and SIWE_DOMAIN
    // defaults both name port 5173, so a shifted port breaks auth in a confusing way.
    strictPort: true,
    proxy: {
      // Same-origin API in dev, exactly as in production, so cookies, CORS and the SIWE domain
      // binding all behave the same in both. `changeOrigin` stays false on purpose: the
      // upstream must keep seeing `Host: localhost:5173`, which is what the session cookie and
      // `SIWE_DOMAIN` are scoped to.
      '/api': { target: API_TARGET, changeOrigin: false, ws: true },
      // Phase 2's real-time socket. `apps/server/src/ws.ts` registers `/ws`, not `/api/ws`, so
      // it needs its own entry — the `/api` rule above would never match it.
      '/ws': { target: API_TARGET, changeOrigin: false, ws: true },
    },
  },

  preview: {
    // 4173 is in the server's default CORS_ORIGIN list, so `pnpm preview` can talk to a locally
    // running API without editing any environment.
    port: 4173,
    strictPort: true,
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Sourcemaps ship. The bundle is minified and the sim is the part most likely to need
    // reading from a production stack trace; .map files cost bandwidth only when DevTools is
    // open, and PM2 runs the server with --enable-source-maps for the same reason.
    sourcemap: true,

    // The floor is set by the CSS, not the JS. styles.css is a verbatim slice of the prototype
    // and uses `aspect-ratio` (Chrome 88 / Safari 15 / Firefox 89) and `env(safe-area-inset-*)`,
    // so a browser older than this cannot lay the game out at all. Transpiling the JS any lower
    // would only make the bundle bigger for browsers that could never render it.
    target: ['es2020', 'chrome88', 'edge88', 'firefox89', 'safari15'],
    // Pinned to the same floor so esbuild's CSS minifier cannot rewrite the verbatim stylesheet
    // into syntax the oldest supported browser rejects. Left unset it defaults to `target`'s
    // esbuild default and can, for example, collapse rgba() into 8-digit hex.
    cssTarget: 'safari15',

    // The art engine is one large procedural module (crown-clash.html L802-1337, sliced
    // verbatim); it is meant to be one chunk and the default 500 kB warning is just noise here.
    chunkSizeWarningLimit: 1200,
  },
});
