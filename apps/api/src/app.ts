import type { HealthResponse } from '@oc/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AuthEnv } from './middleware/auth';
import type { Transcriber } from './transcriber/types';

export interface AppDeps {
  transcriber: Transcriber;
  accessKeys: string[];
  allowedOrigins: string[];
  now?: () => number;
}

export function createApp({ allowedOrigins }: AppDeps) {
  const app = new Hono<AuthEnv>();

  // CORS 必須最先執行：預檢請求不帶 Authorization，且 401/413/429 回應也要有 CORS 標頭。
  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );

  app.get('/health', (c) => c.json({ ok: true } satisfies HealthResponse));

  return app;
}
