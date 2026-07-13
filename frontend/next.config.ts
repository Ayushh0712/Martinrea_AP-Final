import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Pin Turbopack's workspace root to this directory. The repo root also has a
// package-lock.json (for the `concurrently` launcher), which made Next infer the
// wrong workspace root and resolve server modules from the repo-root
// node_modules (causing "Cannot find module '@tanstack/react-query'").
const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * `/api/*` is proxied to the backend so the browser always talks to the same
 * origin (no CORS, no lost `Access-Control-Allow-Origin`). This replaces the
 * rewrite that previously lived in `vercel.json`.
 *
 * The default target is the ngrok tunnel used in production. For local dev
 * against a Nest service, set `API_PROXY_TARGET=http://localhost:3001` (or run
 * with `NEXT_PUBLIC_API_BASE_URL` pointed straight at the backend).
 */
// The two backend services. /api/ingestion/* goes to the ingestion service;
// everything else under /api/* goes to the workflow service (auth, invoices,
// ocr, audit, escalation, documents).
const API_PROXY_TARGET =
  process.env.API_PROXY_TARGET ?? 'http://localhost:3001';
const INGESTION_PROXY_TARGET =
  process.env.INGESTION_PROXY_TARGET ?? 'http://localhost:3002';

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  async rewrites() {
    // Order matters: most-specific paths first, catch-all last.
    return [
      {
        source: '/api/ingestion/:path*',
        destination: `${INGESTION_PROXY_TARGET}/api/ingestion/:path*`,
      },
      {
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
