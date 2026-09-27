import Fastify, { type FastifyInstance } from 'fastify';
import { verifySignature } from './signature.js';
import type { NotionEvent } from './types.js';

export function buildServer(deps: {
  verificationToken: string;
  seenEvent: (id: string) => boolean;
  enqueue: (ev: NotionEvent) => void;
  // Receives the full token so the caller can persist it somewhere private; logs only show a preview.
  onVerificationToken?: (token: string) => void;
  logger?: boolean;
}): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  // Keep the raw body string: the HMAC must run over the exact bytes received.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/webhook/notion', async (req, reply) => {
    const rawBody = req.body as string;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return reply.code(400).send({ error: 'invalid json' });
    }

    const asRecord = parsed as Record<string, unknown>;
    if (typeof asRecord['verification_token'] === 'string') {
      const vt = asRecord['verification_token'] as string;
      req.log.info({ tokenPreview: vt.slice(0, 6) + '…' }, 'verification token received; store it as NOTION_VERIFICATION_TOKEN');
      deps.onVerificationToken?.(vt);
      return reply.code(200).send({ status: 'verification received' });
    }

    // An empty key would make any HMAC computed with '' pass: no token, no events.
    const signature = req.headers['x-notion-signature'] as string | undefined;
    if (!deps.verificationToken || !verifySignature(rawBody, signature, deps.verificationToken)) {
      req.log.warn('invalid webhook signature');
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const event = parsed as NotionEvent;
    if (deps.seenEvent(event.id)) {
      return reply.code(200).send({ status: 'duplicate' });
    }

    deps.enqueue(event);
    return reply.code(200).send({ status: 'accepted' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  return app;
}
