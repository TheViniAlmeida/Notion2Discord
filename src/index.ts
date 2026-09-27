import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pino } from 'pino';
import { loadConfigFromFile } from './config.js';
import { NotionClient } from './notion.js';
import { createProcessor } from './processor.js';
import { JobQueue } from './queue.js';
import { buildServer } from './server.js';
import { SnapshotStore } from './store.js';

const log = pino({ level: process.env['N2D_LOG_LEVEL'] ?? 'info' });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    log.error({ env: name }, 'required env var is not set');
    process.exit(1);
  }
  return value;
}

const notionToken = requireEnv('NOTION_API_TOKEN');
const verificationToken = process.env['NOTION_VERIFICATION_TOKEN'] ?? '';
if (!verificationToken) {
  log.warn(
    'NOTION_VERIFICATION_TOKEN is not set: only the verification handshake will be accepted, every event gets 401',
  );
}

const configPath = process.env['N2D_CONFIG_PATH'] ?? 'config/rules.yaml';
const dbPath = process.env['N2D_DB_PATH'] ?? 'data/n2d.sqlite';
const port = Number(process.env['N2D_PORT'] ?? 8080);

let config: ReturnType<typeof loadConfigFromFile>;
try {
  config = loadConfigFromFile(configPath, process.env);
} catch (err) {
  log.error({ configPath, err: (err as Error).message }, 'invalid config, refusing to start');
  process.exit(1);
}
const store = new SnapshotStore(dbPath);
const notion = new NotionClient(notionToken);
const processor = createProcessor({ config, store, notion, log });
const queue = new JobQueue({
  onError: (err) => log.error({ err }, 'event processing failed after retries'),
});

const app = buildServer({
  verificationToken,
  seenEvent: (id) => store.seenEvent(id),
  enqueue: (ev) => queue.push(() => processor(ev)),
  onVerificationToken: (token) => {
    // Full value goes to a private file on the data volume, never to the log.
    const tokenPath = join(dirname(dbPath), 'verification_token');
    writeFileSync(tokenPath, token + '\n', { mode: 0o600 });
    log.info({ path: tokenPath }, 'verification token saved; paste it in the Notion UI and in .env');
  },
  logger: false,
});

app.listen({ port, host: '0.0.0.0' }).then(
  () => log.info({ port, sources: Object.keys(config.sources), rules: config.rules.length }, 'notion2discord up'),
  (err) => {
    log.error({ err }, 'failed to start server');
    process.exit(1);
  },
);

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  await app.close();
  await queue.idle();
  store.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
