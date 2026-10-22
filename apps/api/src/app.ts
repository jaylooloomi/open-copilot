import type { HealthResponse, TranscribeResponse } from '@oc/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth, type AuthEnv } from './middleware/auth';
import { toTraditional } from './text/toTraditional';
import type { Transcriber } from './transcriber/types';

export interface AppDeps {
  transcriber: Transcriber;
  accessKeys: string[];
  allowedOrigins: string[];
  now?: () => number;
}

export function createApp({ transcriber, accessKeys, allowedOrigins }: AppDeps) {
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

  app.post('/transcribe', bearerAuth(accessKeys), async (c) => {
    const body = await c.req.parseBody();
    const audio = body['audio'] as File;
    const seq = Number(body['seq']);
    const prompt = typeof body['prompt'] === 'string' ? body['prompt'] : '';

    const rawText = await transcriber.transcribe({ file: audio, prompt });
    return c.json({ seq, text: toTraditional(rawText.trim()) } satisfies TranscribeResponse, 200);
  });

  return app;
}
