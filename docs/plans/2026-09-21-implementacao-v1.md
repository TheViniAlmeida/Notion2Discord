# Notion2Discord v1 — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serviço que recebe webhooks nativos do Notion, enriquece os eventos (fetch + diff de snapshot) e roteia para webhooks do Discord (embeds) ou webhooks genéricos (JSON), guiado por regras declarativas em YAML.

**Architecture:** Fastify recebe e valida a assinatura, deduplica e enfileira; um processor busca a página no Notion, compara com snapshot em SQLite e produz um evento enriquecido com mudanças `from→to`; o rules engine casa regras do YAML e os senders entregam embed no Discord ou JSON num webhook genérico (n8n na fase 2).

**Tech Stack:** Node.js 22, TypeScript (ESM), Fastify 5, better-sqlite3, zod, yaml, pino, vitest. Sem SDK do Notion — chamadas via `fetch` com `Notion-Version: 2025-09-03`.

**Spec:** `docs/specs/2026-09-21-notion2discord-design.md`

## Global Constraints

- **Repo público:** NENHUM segredo/URL de webhook em código, YAML versionado, teste ou commit. Envs referenciadas por NOME. `.env` está no `.gitignore`; só `.env.example` (placeholders) é versionado.
- Conteúdo textual (docs, mensagens de commit) em **PT-BR**; código, identificadores e logs em **inglês**.
- Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). **Sem trailers de atribuição de agente** (nada de `Co-Authored-By`, "Generated with…").
- Node >= 22. ESM (`"type": "module"`). Strict TypeScript.
- Config inválida = processo não sobe (fail-fast). Log nunca imprime valor de token/URL de webhook.
- Cada task termina com `npm test` verde antes do commit.

---

### Task 1: Scaffold do projeto

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/types.ts`

**Interfaces:**
- Produces: tipos usados por todas as tasks — `NotionEvent`, `NormalizedPage`, `PropertyChange`, `EnrichedEvent` (assinaturas abaixo).

- [ ] **Step 1: Criar package.json**

```json
{
  "name": "notion2discord",
  "version": "0.1.0",
  "description": "Generic Notion webhooks to Discord embeds relay, driven by declarative YAML rules",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "fastify": "^5.0.0",
    "pino": "^9.0.0",
    "yaml": "^2.5.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Criar tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Criar vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
```

- [ ] **Step 4: Criar .gitignore**

```
node_modules/
dist/
.env
*.env
!.env.example
data/
*.sqlite
*.log
```

- [ ] **Step 5: Criar .env.example**

```
# Notion integration token (create at https://www.notion.so/my-integrations)
NOTION_API_TOKEN=YOUR_NOTION_API_TOKEN_HERE

# Verification token delivered by Notion on the first webhook POST (see README)
NOTION_VERIFICATION_TOKEN=YOUR_VERIFICATION_TOKEN_HERE

# HTTP server
N2D_PORT=8080
N2D_CONFIG_PATH=config/rules.yaml
N2D_DB_PATH=data/n2d.sqlite

# One env var per Discord webhook, referenced BY NAME in config/rules.yaml
DISCORD_WH_DEMANDAS_HISTORICO=https://discord.com/api/webhooks/REPLACE/ME
DISCORD_WH_DEMANDAS_ADICIONADAS=https://discord.com/api/webhooks/REPLACE/ME
DISCORD_WH_DEMANDAS_EMANDAMENTO=https://discord.com/api/webhooks/REPLACE/ME
DISCORD_WH_DEMANDAS_ATUALIZADAS=https://discord.com/api/webhooks/REPLACE/ME
DISCORD_WH_DEMANDAS_FINALIZADAS=https://discord.com/api/webhooks/REPLACE/ME

# Generic webhook targets (phase 2 / n8n)
# N8N_WEBHOOK_DEMANDAS=https://n8n.example.com/webhook/REPLACE/ME
```

- [ ] **Step 6: Criar src/types.ts**

```ts
export type NotionEvent = {
  id: string;
  timestamp: string;
  type: string;
  entity: { id: string; type: string };
  data?: {
    parent?: { id: string; type: string };
    updated_properties?: string[];
  };
};

export type NormalizedPage = {
  id: string;
  url: string;
  title: string;
  properties: Record<string, string | null>;
};

export type PropertyChange = {
  property: string;
  from: string | null;
  to: string | null;
};

export type EnrichedEvent = {
  type: string;
  label: string;
  sourceKey: string;
  page: NormalizedPage;
  changes: PropertyChange[];
  timestamp: string;
};
```

- [ ] **Step 7: Instalar e validar**

Run: `npm install && npm run build && npm test`
Expected: build sem erro; vitest reporta "No test files found" com exit 0 (se sair 1, adicionar `--passWithNoTests` ao script `test` até a Task 2 criar o primeiro teste).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example src/types.ts
git commit -m "chore: scaffold do projeto Node 22 + TypeScript ESM"
```

---

### Task 2: Verificação de assinatura HMAC

**Files:**
- Create: `src/signature.ts`
- Test: `tests/signature.test.ts`

**Interfaces:**
- Produces: `verifySignature(rawBody: string, header: string | undefined, token: string): boolean`

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/signature.js';

const token = 'secret_test_token';
const body = JSON.stringify({ hello: 'world' });
const goodSig = 'sha256=' + createHmac('sha256', token).update(body).digest('hex');

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    expect(verifySignature(body, goodSig, token)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifySignature(body + 'x', goodSig, token)).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(verifySignature(body, undefined, token)).toBe(false);
  });
  it('rejects a malformed header without crashing', () => {
    expect(verifySignature(body, 'not-a-signature', token)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/signature.test.ts`
Expected: FAIL (módulo `src/signature.js` não existe).

- [ ] **Step 3: Implementar src/signature.ts**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(
  rawBody: string,
  header: string | undefined,
  token: string,
): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', token).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/signature.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/signature.ts tests/signature.test.ts
git commit -m "feat: verificacao timing-safe da assinatura X-Notion-Signature"
```

---

### Task 3: Config loader (YAML + zod + resolução de envs)

**Files:**
- Create: `src/config.ts`, `config/rules.example.yaml`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(yamlText: string, env: Record<string, string | undefined>): AppConfig` (lança `Error` com mensagem apontando o campo em config inválida ou env ausente)
  - `loadConfigFromFile(path: string, env: NodeJS.ProcessEnv): AppConfig`
  - Tipos: `AppConfig = { sources: Record<string, { database_id: string }>; targets: Record<string, TargetConfig>; rules: Rule[]; labels: Record<string, string> }`
  - `TargetConfig = { type: 'discord' | 'webhook'; url: string }` (url já resolvida da env)
  - `Rule = { name: string; source: string; on: string[]; when?: WhenCondition; send_to: string[]; embed?: EmbedTemplate }`
  - `WhenCondition = { property: string; changed_to?: string; changed_from?: string; equals?: string; changed?: boolean }`
  - `EmbedTemplate = { title?: string; description?: string; url?: string; color?: string; fields?: { name: string; value: string; inline?: boolean }[] }`

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const yamlOk = `
sources:
  demandas: { database_id: "abc123" }
targets:
  historico: { type: discord, webhook_env: WH_HIST }
  n8n: { type: webhook, url_env: N8N_URL }
rules:
  - name: tudo
    source: demandas
    on: [page.created]
    send_to: [historico]
    embed: { title: "{{page.title}}" }
`;

describe('loadConfig', () => {
  it('parses and resolves target urls from env by name', () => {
    const cfg = loadConfig(yamlOk, { WH_HIST: 'https://d/1', N8N_URL: 'https://n/2' });
    expect(cfg.targets['historico']).toEqual({ type: 'discord', url: 'https://d/1' });
    expect(cfg.targets['n8n']).toEqual({ type: 'webhook', url: 'https://n/2' });
    expect(cfg.rules[0]!.send_to).toEqual(['historico']);
  });
  it('fails naming the missing env var', () => {
    expect(() => loadConfig(yamlOk, { WH_HIST: 'https://d/1' })).toThrow(/N8N_URL/);
  });
  it('fails when a rule references an unknown target', () => {
    const bad = yamlOk.replace('send_to: [historico]', 'send_to: [nope]');
    expect(() => loadConfig(bad, { WH_HIST: 'x', N8N_URL: 'y' })).toThrow(/nope/);
  });
  it('fails when a rule references an unknown source', () => {
    const bad = yamlOk.replace('source: demandas', 'source: ghost');
    expect(() => loadConfig(bad, { WH_HIST: 'x', N8N_URL: 'y' })).toThrow(/ghost/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar src/config.ts**

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const whenSchema = z.object({
  property: z.string(),
  changed_to: z.string().optional(),
  changed_from: z.string().optional(),
  equals: z.string().optional(),
  changed: z.boolean().optional(),
});

const embedFieldSchema = z.object({
  name: z.string(),
  value: z.string(),
  inline: z.boolean().optional(),
});

const embedSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fields: z.array(embedFieldSchema).optional(),
});

const rawTargetSchema = z.union([
  z.object({ type: z.literal('discord'), webhook_env: z.string() }),
  z.object({ type: z.literal('webhook'), url_env: z.string() }),
]);

const rawConfigSchema = z.object({
  sources: z.record(z.string(), z.object({ database_id: z.string() })),
  targets: z.record(z.string(), rawTargetSchema),
  rules: z.array(
    z.object({
      name: z.string(),
      source: z.string(),
      on: z.array(z.string()).min(1),
      when: whenSchema.optional(),
      send_to: z.array(z.string()).min(1),
      embed: embedSchema.optional(),
    }),
  ),
  labels: z.record(z.string(), z.string()).optional(),
});

export type WhenCondition = z.infer<typeof whenSchema>;
export type EmbedTemplate = z.infer<typeof embedSchema>;
export type Rule = z.infer<typeof rawConfigSchema>['rules'][number];
export type TargetConfig = { type: 'discord' | 'webhook'; url: string };
export type AppConfig = {
  sources: Record<string, { database_id: string }>;
  targets: Record<string, TargetConfig>;
  rules: Rule[];
  labels: Record<string, string>;
};

const DEFAULT_LABELS: Record<string, string> = {
  'page.created': 'Tarefa criada',
  'page.properties_updated': 'Tarefa atualizada',
  'page.content_updated': 'Conteúdo atualizado',
  'page.deleted': 'Tarefa removida',
  'page.undeleted': 'Tarefa restaurada',
};

export function loadConfig(
  yamlText: string,
  env: Record<string, string | undefined>,
): AppConfig {
  const raw = rawConfigSchema.parse(parse(yamlText));

  const targets: Record<string, TargetConfig> = {};
  for (const [key, t] of Object.entries(raw.targets)) {
    const envName = t.type === 'discord' ? t.webhook_env : t.url_env;
    const url = env[envName];
    if (!url) throw new Error(`target "${key}": env var ${envName} is not set`);
    targets[key] = { type: t.type, url };
  }

  for (const rule of raw.rules) {
    if (!raw.sources[rule.source]) {
      throw new Error(`rule "${rule.name}": unknown source "${rule.source}"`);
    }
    for (const t of rule.send_to) {
      if (!targets[t]) throw new Error(`rule "${rule.name}": unknown target "${t}"`);
    }
  }

  return {
    sources: raw.sources,
    targets,
    rules: raw.rules,
    labels: { ...DEFAULT_LABELS, ...raw.labels },
  };
}

export function loadConfigFromFile(path: string, env: NodeJS.ProcessEnv): AppConfig {
  return loadConfig(readFileSync(path, 'utf8'), env);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Criar config/rules.example.yaml (caso Demandas completo, com placeholders)**

```yaml
# Example configuration: "Demandas" board with 5 Discord channels.
# Copy to config/rules.yaml and adjust. NEVER put real URLs/secrets here:
# targets reference the NAME of an env var (values live in .env).

sources:
  demandas:
    database_id: "REPLACE_WITH_NOTION_DATABASE_ID"

targets:
  demandas-historico:
    type: discord
    webhook_env: DISCORD_WH_DEMANDAS_HISTORICO
  demandas-adicionadas:
    type: discord
    webhook_env: DISCORD_WH_DEMANDAS_ADICIONADAS
  demandas-emandamento:
    type: discord
    webhook_env: DISCORD_WH_DEMANDAS_EMANDAMENTO
  demandas-atualizadas:
    type: discord
    webhook_env: DISCORD_WH_DEMANDAS_ATUALIZADAS
  demandas-finalizadas:
    type: discord
    webhook_env: DISCORD_WH_DEMANDAS_FINALIZADAS
  # Phase 2 (n8n): uncomment and set N8N_WEBHOOK_DEMANDAS in .env
  # n8n-demandas:
  #   type: webhook
  #   url_env: N8N_WEBHOOK_DEMANDAS

rules:
  - name: historico-tudo
    source: demandas
    on: [page.created, page.properties_updated, page.content_updated, page.deleted]
    send_to: [demandas-historico]
    embed:
      title: "{{event.label}}: {{page.title}}"
      url: "{{page.url}}"
      color: "#5865F2"
      fields:
        - { name: "Status", value: "{{prop.Status}}", inline: true }
        - { name: "Atribuido", value: "{{prop.Atribuido}}", inline: true }

  - name: tarefa-adicionada
    source: demandas
    on: [page.created]
    send_to: [demandas-adicionadas]
    embed:
      title: "🆕 {{page.title}}"
      url: "{{page.url}}"
      color: "#FEE75C"

  - name: tarefa-em-andamento
    source: demandas
    on: [page.properties_updated]
    when: { property: "Status", changed_to: "Em andamento" }
    send_to: [demandas-emandamento]
    embed:
      title: "▶️ {{page.title}}"
      url: "{{page.url}}"
      color: "#EB459E"
      fields:
        - { name: "Status", value: "{{change.from}} → {{change.to}}", inline: true }

  - name: tarefa-atualizada
    source: demandas
    on: [page.properties_updated]
    send_to: [demandas-atualizadas]
    embed:
      title: "✏️ {{page.title}}"
      url: "{{page.url}}"
      color: "#5865F2"
      fields:
        - { name: "Mudanças", value: "{{changes.summary}}", inline: false }

  - name: tarefa-finalizada
    source: demandas
    on: [page.properties_updated]
    when: { property: "Status", changed_to: "Concluido" }
    send_to: [demandas-finalizadas]
    embed:
      title: "✅ {{page.title}}"
      url: "{{page.url}}"
      color: "#57F287"
      fields:
        - { name: "Status", value: "{{change.from}} → {{change.to}}", inline: true }
        - { name: "Atribuido", value: "{{prop.Atribuido}}", inline: true }
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts config/rules.example.yaml
git commit -m "feat: config declarativa em YAML com validacao zod e envs por nome"
```

---

### Task 4: Store SQLite (snapshots + dedup)

**Files:**
- Create: `src/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `NormalizedPage` de `src/types.ts`.
- Produces: `class SnapshotStore { constructor(dbPath: string); seenEvent(eventId: string): boolean; getSnapshot(pageId: string): NormalizedPage | null; saveSnapshot(page: NormalizedPage): void; close(): void }` — `seenEvent` retorna `true` se o evento JÁ tinha sido visto (e registra na primeira vez).

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { SnapshotStore } from '../src/store.js';

const page = {
  id: 'p1',
  url: 'https://notion.so/p1',
  title: 'Task A',
  properties: { Status: 'Não iniciada' },
};

describe('SnapshotStore', () => {
  it('dedups events', () => {
    const s = new SnapshotStore(':memory:');
    expect(s.seenEvent('ev1')).toBe(false);
    expect(s.seenEvent('ev1')).toBe(true);
    expect(s.seenEvent('ev2')).toBe(false);
    s.close();
  });
  it('round-trips snapshots and returns null for unknown pages', () => {
    const s = new SnapshotStore(':memory:');
    expect(s.getSnapshot('p1')).toBeNull();
    s.saveSnapshot(page);
    expect(s.getSnapshot('p1')).toEqual(page);
    s.saveSnapshot({ ...page, properties: { Status: 'Concluido' } });
    expect(s.getSnapshot('p1')!.properties['Status']).toBe('Concluido');
    s.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar src/store.ts**

```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NormalizedPage } from './types.js';

export class SnapshotStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        seen_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        page_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  seenEvent(eventId: string): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO events (id) VALUES (?)')
      .run(eventId);
    return res.changes === 0;
  }

  getSnapshot(pageId: string): NormalizedPage | null {
    const row = this.db
      .prepare('SELECT payload FROM snapshots WHERE page_id = ?')
      .get(pageId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as NormalizedPage) : null;
  }

  saveSnapshot(page: NormalizedPage): void {
    this.db
      .prepare(
        `INSERT INTO snapshots (page_id, payload, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(page_id) DO UPDATE SET payload = excluded.payload,
           updated_at = excluded.updated_at`,
      )
      .run(page.id, JSON.stringify(page));
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: store SQLite para snapshots de pagina e dedup de eventos"
```

---

### Task 5: Cliente Notion + normalização de propriedades

**Files:**
- Create: `src/notion.ts`
- Test: `tests/notion.test.ts`

**Interfaces:**
- Produces:
  - `normalizePage(raw: unknown): NormalizedPage` — converte a resposta crua de `GET /v1/pages/:id` em `NormalizedPage` (valores como texto simples; propriedade vazia → `null`).
  - `class NotionClient { constructor(token: string, fetchFn?: typeof fetch); fetchPage(pageId: string): Promise<NormalizedPage> }` — lança `Error` com o status HTTP em falha.

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { normalizePage, NotionClient } from '../src/notion.js';

const rawPage = {
  id: 'page-1',
  url: 'https://www.notion.so/page-1',
  properties: {
    Name: { type: 'title', title: [{ plain_text: 'Colocar pacote ' }, { plain_text: 'FLA' }] },
    Status: { type: 'status', status: { name: 'Concluido' } },
    Atribuido: { type: 'select', select: { name: 'Hades' } },
    Tags: { type: 'multi_select', multi_select: [{ name: 'infra' }, { name: 'urgente' }] },
    Prazo: { type: 'date', date: { start: '2026-09-30' } },
    Feito: { type: 'checkbox', checkbox: false },
    ID: { type: 'number', number: 30 },
    Pessoas: { type: 'people', people: [{ name: 'Marcos' }] },
    Nota: { type: 'rich_text', rich_text: [] },
    Link: { type: 'url', url: null },
  },
};

describe('normalizePage', () => {
  it('flattens every supported property type to plain text', () => {
    const page = normalizePage(rawPage);
    expect(page.id).toBe('page-1');
    expect(page.title).toBe('Colocar pacote FLA');
    expect(page.properties).toEqual({
      Name: 'Colocar pacote FLA',
      Status: 'Concluido',
      Atribuido: 'Hades',
      Tags: 'infra, urgente',
      Prazo: '2026-09-30',
      Feito: 'false',
      ID: '30',
      Pessoas: 'Marcos',
      Nota: null,
      Link: null,
    });
  });
});

describe('NotionClient', () => {
  it('fetches and normalizes a page', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify(rawPage), { status: 200 })) as typeof fetch;
    const client = new NotionClient('tok', fetchFn);
    const page = await client.fetchPage('page-1');
    expect(page.title).toBe('Colocar pacote FLA');
  });
  it('throws with the HTTP status on failure', async () => {
    const fetchFn = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    const client = new NotionClient('tok', fetchFn);
    await expect(client.fetchPage('missing')).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/notion.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar src/notion.ts**

```ts
import type { NormalizedPage } from './types.js';

const NOTION_VERSION = '2025-09-03';
const API_BASE = 'https://api.notion.com/v1';

type RichTextItem = { plain_text: string };

function joinRichText(items: RichTextItem[] | undefined): string | null {
  const text = (items ?? []).map((i) => i.plain_text).join('');
  return text === '' ? null : text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeProperty(prop: any): string | null {
  switch (prop?.type) {
    case 'title':
      return joinRichText(prop.title);
    case 'rich_text':
      return joinRichText(prop.rich_text);
    case 'status':
      return prop.status?.name ?? null;
    case 'select':
      return prop.select?.name ?? null;
    case 'multi_select':
      return prop.multi_select?.length
        ? prop.multi_select.map((o: { name: string }) => o.name).join(', ')
        : null;
    case 'date':
      return prop.date?.start ?? null;
    case 'checkbox':
      return String(prop.checkbox);
    case 'number':
      return prop.number === null || prop.number === undefined ? null : String(prop.number);
    case 'people':
      return prop.people?.length
        ? prop.people.map((p: { name?: string }) => p.name ?? 'unknown').join(', ')
        : null;
    case 'url':
      return prop.url ?? null;
    case 'email':
      return prop.email ?? null;
    case 'phone_number':
      return prop.phone_number ?? null;
    case 'unique_id':
      return prop.unique_id ? `${prop.unique_id.prefix ?? ''}${prop.unique_id.number}` : null;
    default:
      return null; // formula, relation, rollup etc.: out of scope in v1
  }
}

export function normalizePage(raw: unknown): NormalizedPage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = raw as any;
  const properties: Record<string, string | null> = {};
  let title = '';
  for (const [name, prop] of Object.entries(page.properties ?? {})) {
    const value = normalizeProperty(prop);
    properties[name] = value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((prop as any)?.type === 'title') title = value ?? '';
  }
  return { id: page.id, url: page.url ?? '', title, properties };
}

export class NotionClient {
  constructor(
    private token: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async fetchPage(pageId: string): Promise<NormalizedPage> {
    const res = await this.fetchFn(`${API_BASE}/pages/${pageId}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
      },
    });
    if (!res.ok) throw new Error(`Notion API error ${res.status} fetching page`);
    return normalizePage(await res.json());
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/notion.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/notion.ts tests/notion.test.ts
git commit -m "feat: cliente da API do Notion e normalizacao de propriedades"
```

---

### Task 6: Diff de snapshot

**Files:**
- Create: `src/diff.ts`
- Test: `tests/diff.test.ts`

**Interfaces:**
- Consumes: `NormalizedPage`, `PropertyChange`.
- Produces: `diffProperties(prev: NormalizedPage | null, next: NormalizedPage): PropertyChange[]`

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { diffProperties } from '../src/diff.js';

const base = { id: 'p1', url: 'u', title: 't', properties: {} };

describe('diffProperties', () => {
  it('reports changed properties with from/to', () => {
    const prev = { ...base, properties: { Status: 'Não iniciada', Prio: null } };
    const next = { ...base, properties: { Status: 'Concluido', Prio: null } };
    expect(diffProperties(prev, next)).toEqual([
      { property: 'Status', from: 'Não iniciada', to: 'Concluido' },
    ]);
  });
  it('treats a new page (null prev) as all-from-null', () => {
    const next = { ...base, properties: { Status: 'Não iniciada', Prio: null } };
    expect(diffProperties(null, next)).toEqual([
      { property: 'Status', from: null, to: 'Não iniciada' },
    ]);
  });
  it('reports properties removed from the schema', () => {
    const prev = { ...base, properties: { Old: 'x' } };
    const next = { ...base, properties: {} };
    expect(diffProperties(prev, next)).toEqual([{ property: 'Old', from: 'x', to: null }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/diff.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar src/diff.ts**

```ts
import type { NormalizedPage, PropertyChange } from './types.js';

export function diffProperties(
  prev: NormalizedPage | null,
  next: NormalizedPage,
): PropertyChange[] {
  const prevProps = prev?.properties ?? {};
  const changes: PropertyChange[] = [];
  const names = new Set([...Object.keys(prevProps), ...Object.keys(next.properties)]);
  for (const name of names) {
    const from = prevProps[name] ?? null;
    const to = next.properties[name] ?? null;
    if (from !== to) changes.push({ property: name, from, to });
  }
  return changes;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/diff.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts tests/diff.test.ts
git commit -m "feat: diff de propriedades entre snapshot e pagina atual"
```

---

### Task 7: Rules engine

**Files:**
- Create: `src/rules.ts`
- Test: `tests/rules.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `Rule`, `WhenCondition` (Task 3); `EnrichedEvent` (Task 1).
- Produces: `matchRules(config: AppConfig, event: EnrichedEvent): Rule[]`

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { matchRules } from '../src/rules.js';
import type { AppConfig } from '../src/config.js';

const cfg: AppConfig = {
  sources: { demandas: { database_id: 'db1' } },
  targets: { t1: { type: 'discord', url: 'u1' } },
  labels: {},
  rules: [
    { name: 'all', source: 'demandas', on: ['page.created', 'page.properties_updated'], send_to: ['t1'] },
    {
      name: 'done',
      source: 'demandas',
      on: ['page.properties_updated'],
      when: { property: 'Status', changed_to: 'Concluido' },
      send_to: ['t1'],
    },
    {
      name: 'started',
      source: 'demandas',
      on: ['page.properties_updated'],
      when: { property: 'Status', changed_from: 'Não iniciada' },
      send_to: ['t1'],
    },
    {
      name: 'assigned-hades',
      source: 'demandas',
      on: ['page.properties_updated'],
      when: { property: 'Atribuido', equals: 'Hades' },
      send_to: ['t1'],
    },
    {
      name: 'other-source',
      source: 'demandas',
      on: ['page.created'],
      send_to: ['t1'],
    },
  ],
};

function ev(type: string, changes: { property: string; from: string | null; to: string | null }[], props: Record<string, string | null> = {}) {
  return {
    type,
    label: type,
    sourceKey: 'demandas',
    timestamp: 't',
    changes,
    page: { id: 'p', url: 'u', title: 'T', properties: props },
  };
}

describe('matchRules', () => {
  it('matches by event type when there is no when', () => {
    const rules = matchRules(cfg, ev('page.created', []));
    expect(rules.map((r) => r.name)).toEqual(['all', 'other-source']);
  });
  it('matches changed_to against the changes list', () => {
    const rules = matchRules(cfg, ev('page.properties_updated', [
      { property: 'Status', from: 'Em andamento', to: 'Concluido' },
    ]));
    expect(rules.map((r) => r.name)).toContain('done');
    expect(rules.map((r) => r.name)).not.toContain('started');
  });
  it('matches changed_from', () => {
    const rules = matchRules(cfg, ev('page.properties_updated', [
      { property: 'Status', from: 'Não iniciada', to: 'Em andamento' },
    ]));
    expect(rules.map((r) => r.name)).toContain('started');
  });
  it('matches equals against current page properties', () => {
    const rules = matchRules(cfg, ev('page.properties_updated',
      [{ property: 'Prazo', from: null, to: 'x' }], { Atribuido: 'Hades' }));
    expect(rules.map((r) => r.name)).toContain('assigned-hades');
  });
  it('does not match rules from another source', () => {
    const rules = matchRules(cfg, { ...ev('page.created', []), sourceKey: 'outra' });
    expect(rules).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/rules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar src/rules.ts**

```ts
import type { AppConfig, Rule, WhenCondition } from './config.js';
import type { EnrichedEvent } from './types.js';

function whenMatches(when: WhenCondition, event: EnrichedEvent): boolean {
  const change = event.changes.find((c) => c.property === when.property);
  if (when.changed_to !== undefined) {
    if (!change || change.to !== when.changed_to) return false;
  }
  if (when.changed_from !== undefined) {
    if (!change || change.from !== when.changed_from) return false;
  }
  if (when.changed === true && !change) return false;
  if (when.equals !== undefined) {
    if ((event.page.properties[when.property] ?? null) !== when.equals) return false;
  }
  return true;
}

export function matchRules(config: AppConfig, event: EnrichedEvent): Rule[] {
  return config.rules.filter((rule) => {
    if (rule.source !== event.sourceKey) return false;
    if (!rule.on.includes(event.type)) return false;
    if (rule.when && !whenMatches(rule.when, event)) return false;
    return true;
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/rules.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/rules.ts tests/rules.test.ts
git commit -m "feat: rules engine declarativo (on + when: changed_to/changed_from/equals/changed)"
```

---

### Task 8: Renderização de templates e embeds

**Files:**
- Create: `src/template.ts`
- Test: `tests/template.test.ts`

**Interfaces:**
- Consumes: `EmbedTemplate`, `Rule` (Task 3); `EnrichedEvent` (Task 1).
- Produces:
  - `renderString(tpl: string, event: EnrichedEvent, rule: Rule): string` — placeholders: `{{page.title}}`, `{{page.url}}`, `{{event.type}}`, `{{event.label}}`, `{{prop.<Nome>}}`, `{{change.from}}`, `{{change.to}}`, `{{changes.summary}}`. Placeholder sem valor vira `—`.
  - `renderEmbed(tpl: EmbedTemplate, event: EnrichedEvent, rule: Rule): DiscordEmbed`
  - `type DiscordEmbed = { title?: string; description?: string; url?: string; color?: number; fields?: { name: string; value: string; inline?: boolean }[]; timestamp?: string }`
  - `change.from/to` referem-se à mudança da propriedade do `when` da regra; sem `when`, à primeira mudança da lista.
  - Limites do Discord aplicados: title ≤ 256, description ≤ 4096, field name ≤ 256, field value ≤ 1024, ≤ 25 fields (truncar com `…`).

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { renderString, renderEmbed } from '../src/template.js';
import type { Rule } from '../src/config.js';
import type { EnrichedEvent } from '../src/types.js';

const event: EnrichedEvent = {
  type: 'page.properties_updated',
  label: 'Tarefa atualizada',
  sourceKey: 'demandas',
  timestamp: '2026-09-21T12:00:00.000Z',
  changes: [
    { property: 'Status', from: 'Em andamento', to: 'Concluido' },
    { property: 'Prazo', from: null, to: '2026-09-30' },
  ],
  page: {
    id: 'p1',
    url: 'https://notion.so/p1',
    title: 'Pacote FLA',
    properties: { Status: 'Concluido', Atribuido: 'Hades' },
  },
};

const rule: Rule = {
  name: 'done',
  source: 'demandas',
  on: ['page.properties_updated'],
  when: { property: 'Status', changed_to: 'Concluido' },
  send_to: ['t'],
};

describe('renderString', () => {
  it('interpolates page, event, prop and change placeholders', () => {
    expect(renderString('{{event.label}}: {{page.title}} ({{prop.Atribuido}})', event, rule))
      .toBe('Tarefa atualizada: Pacote FLA (Hades)');
    expect(renderString('{{change.from}} → {{change.to}}', event, rule))
      .toBe('Em andamento → Concluido');
  });
  it('renders a summary of all changes', () => {
    expect(renderString('{{changes.summary}}', event, rule))
      .toBe('Status: Em andamento → Concluido\nPrazo: — → 2026-09-30');
  });
  it('falls back to em dash for unknown values', () => {
    expect(renderString('{{prop.Nada}}', event, rule)).toBe('—');
  });
});

describe('renderEmbed', () => {
  it('builds a Discord embed with numeric color and truncation', () => {
    const embed = renderEmbed(
      { title: 'X'.repeat(300), color: '#57F287', url: '{{page.url}}' },
      event,
      rule,
    );
    expect(embed.title!.length).toBe(256);
    expect(embed.color).toBe(0x57f287);
    expect(embed.url).toBe('https://notion.so/p1');
    expect(embed.timestamp).toBe(event.timestamp);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar src/template.ts**

```ts
import type { EmbedTemplate, Rule } from './config.js';
import type { EnrichedEvent, PropertyChange } from './types.js';

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
};

const EMPTY = '—';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function primaryChange(event: EnrichedEvent, rule: Rule): PropertyChange | undefined {
  if (rule.when) return event.changes.find((c) => c.property === rule.when!.property);
  return event.changes[0];
}

function changesSummary(event: EnrichedEvent): string {
  if (event.changes.length === 0) return EMPTY;
  return event.changes
    .map((c) => `${c.property}: ${c.from ?? EMPTY} → ${c.to ?? EMPTY}`)
    .join('\n');
}

export function renderString(tpl: string, event: EnrichedEvent, rule: Rule): string {
  const change = primaryChange(event, rule);
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (key === 'page.title') return event.page.title || EMPTY;
    if (key === 'page.url') return event.page.url || EMPTY;
    if (key === 'page.id') return event.page.id;
    if (key === 'event.type') return event.type;
    if (key === 'event.label') return event.label;
    if (key === 'change.from') return change?.from ?? EMPTY;
    if (key === 'change.to') return change?.to ?? EMPTY;
    if (key === 'changes.summary') return changesSummary(event);
    if (key.startsWith('prop.')) return event.page.properties[key.slice(5)] ?? EMPTY;
    return EMPTY;
  });
}

export function renderEmbed(
  tpl: EmbedTemplate,
  event: EnrichedEvent,
  rule: Rule,
): DiscordEmbed {
  const embed: DiscordEmbed = { timestamp: event.timestamp };
  if (tpl.title) embed.title = truncate(renderString(tpl.title, event, rule), 256);
  if (tpl.description)
    embed.description = truncate(renderString(tpl.description, event, rule), 4096);
  if (tpl.url) embed.url = renderString(tpl.url, event, rule);
  if (tpl.color) embed.color = parseInt(tpl.color.slice(1), 16);
  if (tpl.fields) {
    embed.fields = tpl.fields.slice(0, 25).map((f) => ({
      name: truncate(renderString(f.name, event, rule), 256),
      value: truncate(renderString(f.value, event, rule), 1024),
      inline: f.inline,
    }));
  }
  return embed;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/template.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/template.ts tests/template.test.ts
git commit -m "feat: templates {{...}} e montagem de embeds com limites do Discord"
```

---

### Task 9: Senders (Discord + webhook genérico)

**Files:**
- Create: `src/senders.ts`
- Test: `tests/senders.test.ts`

**Interfaces:**
- Consumes: `TargetConfig` (Task 3), `DiscordEmbed` (Task 8), `EnrichedEvent` (Task 1).
- Produces: `sendToTarget(target: TargetConfig, event: EnrichedEvent, embed: DiscordEmbed | null, fetchFn?: typeof fetch): Promise<void>` — discord: POST `{ embeds: [embed] }`; em 429 espera `retry_after` (segundos, do corpo JSON) e tenta 1 vez de novo; 5xx: 1 retry; 4xx: lança `Error`. webhook: POST do `event` completo em JSON, mesma política de retry.

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect, vi } from 'vitest';
import { sendToTarget } from '../src/senders.js';
import type { EnrichedEvent } from '../src/types.js';

const event: EnrichedEvent = {
  type: 'page.created',
  label: 'Tarefa criada',
  sourceKey: 'demandas',
  timestamp: 't',
  changes: [],
  page: { id: 'p', url: 'u', title: 'T', properties: {} },
};
const embed = { title: 'T' };

function fetchSeq(responses: Response[]): typeof fetch {
  const fn = vi.fn(async () => responses.shift()!);
  return fn as unknown as typeof fetch;
}

describe('sendToTarget', () => {
  it('posts an embed payload to discord targets', async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchFn = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: init.body });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await sendToTarget({ type: 'discord', url: 'https://d/wh' }, event, embed, fetchFn);
    expect(calls[0]!.url).toBe('https://d/wh');
    expect(JSON.parse(calls[0]!.body)).toEqual({ embeds: [embed] });
  });
  it('posts the enriched event as JSON to webhook targets', async () => {
    const calls: string[] = [];
    const fetchFn = (async (_u: any, init: any) => {
      calls.push(init.body);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await sendToTarget({ type: 'webhook', url: 'https://n8n/wh' }, event, null, fetchFn);
    expect(JSON.parse(calls[0]!)).toMatchObject({ type: 'page.created' });
  });
  it('retries once after a 429 honoring retry_after', async () => {
    vi.useFakeTimers();
    const fetchFn = fetchSeq([
      new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }),
      new Response(null, { status: 204 }),
    ]);
    const p = sendToTarget({ type: 'discord', url: 'https://d/wh' }, event, embed, fetchFn);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
  it('throws on 4xx without retrying', async () => {
    const fetchFn = fetchSeq([new Response('bad', { status: 400 })]);
    await expect(
      sendToTarget({ type: 'discord', url: 'https://d/wh' }, event, embed, fetchFn),
    ).rejects.toThrow(/400/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/senders.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar src/senders.ts**

```ts
import type { TargetConfig } from './config.js';
import type { DiscordEmbed } from './template.js';
import type { EnrichedEvent } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendToTarget(
  target: TargetConfig,
  event: EnrichedEvent,
  embed: DiscordEmbed | null,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const body =
    target.type === 'discord' ? JSON.stringify({ embeds: [embed] }) : JSON.stringify(event);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchFn(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.ok) return;

    if (res.status === 429 && attempt === 0) {
      let retryAfter = 1;
      try {
        const data = (await res.json()) as { retry_after?: number };
        if (typeof data.retry_after === 'number') retryAfter = data.retry_after;
      } catch {
        // keep default
      }
      await sleep(retryAfter * 1000);
      continue;
    }
    if (res.status >= 500 && attempt === 0) {
      await sleep(500);
      continue;
    }
    throw new Error(`target responded ${res.status}`);
  }
  throw new Error('target retry exhausted');
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/senders.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/senders.ts tests/senders.test.ts
git commit -m "feat: senders discord (embed, 429/retry) e webhook generico (JSON)"
```

---

### Task 10: Fila em memória com retry

**Files:**
- Create: `src/queue.ts`
- Test: `tests/queue.test.ts`

**Interfaces:**
- Produces: `class JobQueue { constructor(opts?: { retries?: number; baseDelayMs?: number; onError?: (err: unknown) => void }); push(job: () => Promise<void>): void; idle(): Promise<void> }` — processa em série (concorrência 1); job que lança é re-tentado `retries` vezes (default 3) com backoff exponencial `baseDelayMs * 2^n` (default 250ms); esgotou → chama `onError` e segue para o próximo. `idle()` resolve quando a fila esvazia (para testes e shutdown).

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect, vi } from 'vitest';
import { JobQueue } from '../src/queue.js';

describe('JobQueue', () => {
  it('runs jobs in order', async () => {
    const order: number[] = [];
    const q = new JobQueue({ baseDelayMs: 1 });
    q.push(async () => void order.push(1));
    q.push(async () => void order.push(2));
    await q.idle();
    expect(order).toEqual([1, 2]);
  });
  it('retries failing jobs then reports the final error', async () => {
    let attempts = 0;
    const onError = vi.fn();
    const q = new JobQueue({ retries: 2, baseDelayMs: 1, onError });
    q.push(async () => {
      attempts++;
      throw new Error('boom');
    });
    await q.idle();
    expect(attempts).toBe(3); // 1 tentativa + 2 retries
    expect(onError).toHaveBeenCalledOnce();
  });
  it('a failing job does not block the next one', async () => {
    const done: string[] = [];
    const q = new JobQueue({ retries: 0, baseDelayMs: 1, onError: () => {} });
    q.push(async () => {
      throw new Error('x');
    });
    q.push(async () => void done.push('ok'));
    await q.idle();
    expect(done).toEqual(['ok']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/queue.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar src/queue.ts**

```ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = () => Promise<void>;

export class JobQueue {
  private jobs: Job[] = [];
  private running = false;
  private waiters: (() => void)[] = [];
  private retries: number;
  private baseDelayMs: number;
  private onError: (err: unknown) => void;

  constructor(opts?: {
    retries?: number;
    baseDelayMs?: number;
    onError?: (err: unknown) => void;
  }) {
    this.retries = opts?.retries ?? 3;
    this.baseDelayMs = opts?.baseDelayMs ?? 250;
    this.onError = opts?.onError ?? (() => {});
  }

  push(job: Job): void {
    this.jobs.push(job);
    if (!this.running) void this.run();
  }

  idle(): Promise<void> {
    if (!this.running && this.jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async run(): Promise<void> {
    this.running = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      for (let attempt = 0; ; attempt++) {
        try {
          await job();
          break;
        } catch (err) {
          if (attempt >= this.retries) {
            this.onError(err);
            break;
          }
          await sleep(this.baseDelayMs * 2 ** attempt);
        }
      }
    }
    this.running = false;
    for (const w of this.waiters.splice(0)) w();
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/queue.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/queue.ts tests/queue.test.ts
git commit -m "feat: fila em memoria serial com retry e backoff exponencial"
```

---

### Task 11: Processor (orquestração fetch → diff → rules → send)

**Files:**
- Create: `src/processor.ts`
- Test: `tests/processor.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `matchRules`, `renderEmbed`, `sendToTarget`, `SnapshotStore`, `NotionClient`, `diffProperties`, tipos de `types.ts`.
- Produces: `createProcessor(deps: { config: AppConfig; store: SnapshotStore; notion: Pick<NotionClient, 'fetchPage'>; send?: typeof sendToTarget; log?: { debug: Function; warn: Function; error: Function } }): (raw: NotionEvent) => Promise<void>` — comportamento:
  1. resolve `sourceKey` comparando `raw.data.parent.id` (hífens removidos, lowercase) com `sources[*].database_id`; sem match → descarta (debug).
  2. `page.deleted`/`page.undeleted`: usa o snapshot como página (fetch falharia); demais tipos: `notion.fetchPage`.
  3. diff contra snapshot; salva snapshot novo (exceto em deleted).
  4. `matchRules`; para cada regra × target: target `discord` exige `rule.embed` (sem embed → warn e pula); target `webhook` manda o evento.

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createProcessor } from '../src/processor.js';
import { SnapshotStore } from '../src/store.js';
import type { AppConfig } from '../src/config.js';
import type { NormalizedPage, NotionEvent } from '../src/types.js';

const cfg: AppConfig = {
  sources: { demandas: { database_id: 'aaaa1111' } },
  targets: {
    done: { type: 'discord', url: 'https://d/done' },
    feed: { type: 'webhook', url: 'https://n8n/feed' },
  },
  labels: { 'page.properties_updated': 'Tarefa atualizada' },
  rules: [
    {
      name: 'done',
      source: 'demandas',
      on: ['page.properties_updated'],
      when: { property: 'Status', changed_to: 'Concluido' },
      send_to: ['done', 'feed'],
      embed: { title: '✅ {{page.title}}' },
    },
  ],
};

const pageV2: NormalizedPage = {
  id: 'p1', url: 'u', title: 'Pacote FLA', properties: { Status: 'Concluido' },
};

const rawEvent: NotionEvent = {
  id: 'ev1',
  timestamp: '2026-09-21T12:00:00.000Z',
  type: 'page.properties_updated',
  entity: { id: 'p1', type: 'page' },
  data: { parent: { id: 'aaaa-1111', type: 'database' }, updated_properties: ['x'] },
};

describe('processor', () => {
  it('fetches, diffs, matches and sends to every target of the rule', async () => {
    const store = new SnapshotStore(':memory:');
    store.saveSnapshot({ ...pageV2, properties: { Status: 'Em andamento' } });
    const send = vi.fn(async () => {});
    const proc = createProcessor({
      config: cfg,
      store,
      notion: { fetchPage: async () => pageV2 },
      send,
    });
    await proc(rawEvent);
    expect(send).toHaveBeenCalledTimes(2);
    const [target1, event1, embed1] = send.mock.calls[0]!;
    expect(target1).toEqual(cfg.targets['done']);
    expect(event1.changes).toEqual([
      { property: 'Status', from: 'Em andamento', to: 'Concluido' },
    ]);
    expect(embed1).toMatchObject({ title: '✅ Pacote FLA' });
    expect(store.getSnapshot('p1')!.properties['Status']).toBe('Concluido');
    store.close();
  });
  it('discards events from unknown databases without fetching', async () => {
    const store = new SnapshotStore(':memory:');
    const fetchPage = vi.fn();
    const send = vi.fn(async () => {});
    const proc = createProcessor({
      config: cfg,
      store,
      notion: { fetchPage } as never,
      send,
    });
    await proc({ ...rawEvent, data: { parent: { id: 'other', type: 'database' } } });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    store.close();
  });
  it('uses the snapshot for page.deleted events', async () => {
    const store = new SnapshotStore(':memory:');
    store.saveSnapshot(pageV2);
    const send = vi.fn(async () => {});
    const cfgDel: AppConfig = {
      ...cfg,
      rules: [{ name: 'del', source: 'demandas', on: ['page.deleted'], send_to: ['feed'] }],
    };
    const proc = createProcessor({
      config: cfgDel,
      store,
      notion: { fetchPage: vi.fn(async () => { throw new Error('should not fetch'); }) },
      send,
    });
    await proc({ ...rawEvent, type: 'page.deleted' });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![1].page.title).toBe('Pacote FLA');
    store.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/processor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar src/processor.ts**

```ts
import type { AppConfig } from './config.js';
import { diffProperties } from './diff.js';
import type { NotionClient } from './notion.js';
import { matchRules } from './rules.js';
import { sendToTarget } from './senders.js';
import type { SnapshotStore } from './store.js';
import { renderEmbed } from './template.js';
import type { EnrichedEvent, NotionEvent } from './types.js';

type Logger = {
  debug: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

const noopLog: Logger = { debug: () => {}, warn: () => {}, error: () => {} };

function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

function resolveSource(config: AppConfig, raw: NotionEvent): string | null {
  const parentId = raw.data?.parent?.id;
  if (!parentId) return null;
  const wanted = normalizeId(parentId);
  for (const [key, src] of Object.entries(config.sources)) {
    if (normalizeId(src.database_id) === wanted) return key;
  }
  return null;
}

export function createProcessor(deps: {
  config: AppConfig;
  store: SnapshotStore;
  notion: Pick<NotionClient, 'fetchPage'>;
  send?: typeof sendToTarget;
  log?: Logger;
}): (raw: NotionEvent) => Promise<void> {
  const { config, store, notion } = deps;
  const send = deps.send ?? sendToTarget;
  const log = deps.log ?? noopLog;

  return async (raw: NotionEvent) => {
    const sourceKey = resolveSource(config, raw);
    if (!sourceKey) {
      log.debug({ eventId: raw.id, type: raw.type }, 'event from unknown database, discarded');
      return;
    }

    const isDeletion = raw.type === 'page.deleted';
    const prev = store.getSnapshot(raw.entity.id);
    const page = isDeletion ? prev : await notion.fetchPage(raw.entity.id);
    if (!page) {
      log.warn({ eventId: raw.id, type: raw.type }, 'deletion without snapshot, discarded');
      return;
    }

    const changes = isDeletion ? [] : diffProperties(prev, page);
    if (!isDeletion) store.saveSnapshot(page);

    const event: EnrichedEvent = {
      type: raw.type,
      label: config.labels[raw.type] ?? raw.type,
      sourceKey,
      page,
      changes,
      timestamp: raw.timestamp,
    };

    const rules = matchRules(config, event);
    if (rules.length === 0) {
      log.debug({ eventId: raw.id, type: raw.type }, 'no rule matched');
      return;
    }

    for (const rule of rules) {
      for (const targetKey of rule.send_to) {
        const target = config.targets[targetKey]!;
        if (target.type === 'discord') {
          if (!rule.embed) {
            log.warn({ rule: rule.name, target: targetKey }, 'discord target without embed template, skipped');
            continue;
          }
          await send(target, event, renderEmbed(rule.embed, event, rule));
        } else {
          await send(target, event, null);
        }
      }
    }
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/processor.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/processor.ts tests/processor.test.ts
git commit -m "feat: processor liga fetch, diff, regras e envio por target"
```

---

### Task 12: Servidor Fastify (webhook + healthz)

**Files:**
- Create: `src/server.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: `verifySignature` (Task 2), `SnapshotStore.seenEvent` (Task 4), `NotionEvent`.
- Produces: `buildServer(deps: { verificationToken: string; seenEvent: (id: string) => boolean; enqueue: (ev: NotionEvent) => void; logger?: boolean }): FastifyInstance` — rotas:
  - `POST /webhook/notion`: corpo com `verification_token` → loga `info` (token MASCARADO: 6 primeiros chars + `…`) e responde 200; assinatura inválida → 401; evento duplicado → 200 `{ status: 'duplicate' }`; válido → `enqueue` e 200 `{ status: 'accepted' }`. A assinatura é verificada sobre o **corpo bruto** (usar `addContentTypeParser` para preservar a string).
  - `GET /healthz`: 200 `{ status: 'ok' }`.

- [ ] **Step 1: Escrever teste que falha**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildServer } from '../src/server.js';

const token = 'secret_tok';
const sign = (body: string) =>
  'sha256=' + createHmac('sha256', token).update(body).digest('hex');

const event = {
  id: 'ev1',
  timestamp: 't',
  type: 'page.created',
  entity: { id: 'p1', type: 'page' },
};

function makeApp(overrides?: Partial<Parameters<typeof buildServer>[0]>) {
  return buildServer({
    verificationToken: token,
    seenEvent: () => false,
    enqueue: vi.fn(),
    ...overrides,
  });
}

describe('POST /webhook/notion', () => {
  it('accepts a signed event and enqueues it', async () => {
    const enqueue = vi.fn();
    const app = makeApp({ enqueue });
    const body = JSON.stringify(event);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-notion-signature': sign(body) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'accepted' });
    expect(enqueue).toHaveBeenCalledWith(event);
  });
  it('rejects an invalid signature with 401', async () => {
    const enqueue = vi.fn();
    const app = makeApp({ enqueue });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: JSON.stringify(event),
      headers: { 'content-type': 'application/json', 'x-notion-signature': 'sha256=deadbeef' },
    });
    expect(res.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('answers 200 to the verification handshake without a signature', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: JSON.stringify({ verification_token: 'secret_vt_abcdef123' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
  });
  it('acknowledges duplicates without enqueueing', async () => {
    const enqueue = vi.fn();
    const app = makeApp({ enqueue, seenEvent: () => true });
    const body = JSON.stringify(event);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-notion-signature': sign(body) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'duplicate' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('GET /healthz', () => {
  it('returns ok', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar src/server.ts**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { verifySignature } from './signature.js';
import type { NotionEvent } from './types.js';

export function buildServer(deps: {
  verificationToken: string;
  seenEvent: (id: string) => boolean;
  enqueue: (ev: NotionEvent) => void;
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
      return reply.code(200).send({ status: 'verification received' });
    }

    const signature = req.headers['x-notion-signature'] as string | undefined;
    if (!verifySignature(rawBody, signature, deps.verificationToken)) {
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: servidor fastify com assinatura sobre corpo bruto, handshake e dedup"
```

---

### Task 13: Entrypoint e wiring

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: processo executável (`npm start` / `npm run dev`).

- [ ] **Step 1: Implementar src/index.ts**

```ts
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
    'NOTION_VERIFICATION_TOKEN is not set: only the verification handshake will be accepted',
  );
}

const configPath = process.env['N2D_CONFIG_PATH'] ?? 'config/rules.yaml';
const dbPath = process.env['N2D_DB_PATH'] ?? 'data/n2d.sqlite';
const port = Number(process.env['N2D_PORT'] ?? 8080);

const config = loadConfigFromFile(configPath, process.env); // fail-fast
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
```

- [ ] **Step 2: Validar build e suíte inteira**

Run: `npm run build && npm test`
Expected: build limpo; todos os testes PASS.

- [ ] **Step 3: Smoke test local (sem Notion real)**

```bash
cp .env.example .env   # placeholders servem para o smoke
cp config/rules.example.yaml config/rules.yaml
npx tsx src/index.ts &
sleep 2
curl -s http://localhost:8080/healthz
curl -s -X POST http://localhost:8080/webhook/notion -H 'Content-Type: application/json' -d '{"verification_token":"secret_test"}'
kill %1
```

Expected: `{"status":"ok"}` e `{"status":"verification received"}`.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: entrypoint com fail-fast de config e shutdown gracioso"
```

---

### Task 14: Docker

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`

- [ ] **Step 1: Criar .dockerignore**

```
node_modules
dist
data
.env
*.env
.git
docs
```

- [ ] **Step 2: Criar Dockerfile (multistage, non-root)**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Criar docker-compose.yml**

```yaml
services:
  notion2discord:
    build: .
    image: notion2discord:latest
    restart: unless-stopped
    env_file: .env
    environment:
      N2D_CONFIG_PATH: /app/config/rules.yaml
      N2D_DB_PATH: /app/data/n2d.sqlite
    volumes:
      - ./config/rules.yaml:/app/config/rules.yaml:ro
      - n2d-data:/app/data
    # Internal by default: expose via reverse proxy (Nginx-UI), not a host port.
    # For local testing only, uncomment:
    # ports:
    #   - "127.0.0.1:8080:8080"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  n2d-data:
```

- [ ] **Step 4: Validar build da imagem**

Run: `docker build -t notion2discord:latest .`
Expected: build completa sem erro. (Se `better-sqlite3` não tiver prebuilt para a plataforma, adicionar `RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*` antes do `npm ci` no estágio de build.)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "chore: imagem multistage non-root e compose com volume dedicado"
```

---

### Task 15: Documentação da fase 2 (n8n)

**Files:**
- Create: `docs/n8n.md`

- [ ] **Step 1: Criar docs/n8n.md**

Conteúdo obrigatório (redigir em PT-BR):

1. **Contrato**: o n8n NÃO recebe webhook do Notion; recebe do Notion2Discord, via target `type: webhook`, o `EnrichedEvent` em JSON. Documentar o shape com exemplo real:

```json
{
  "type": "page.properties_updated",
  "label": "Tarefa atualizada",
  "sourceKey": "demandas",
  "timestamp": "2026-09-21T12:00:00.000Z",
  "page": {
    "id": "page-uuid",
    "url": "https://www.notion.so/...",
    "title": "Colocar pacote de unifomes FLA",
    "properties": { "Status": "Concluido", "Atribuido": "Hades" }
  },
  "changes": [
    { "property": "Status", "from": "Em andamento", "to": "Concluido" }
  ]
}
```

2. **Passo a passo**: criar workflow no n8n com node "Webhook" (método POST), copiar a URL de produção, gravá-la no `.env` do Notion2Discord (ex.: `N8N_WEBHOOK_DEMANDAS=...`), adicionar o target `type: webhook` e a(s) regra(s) no `rules.yaml`, reiniciar o container.
3. **Exemplo de regra** roteando `page.created` + `page.properties_updated` para o n8n (copiar o bloco comentado do `rules.example.yaml`).
4. **Anti-duplicação**: regra explícita — toda automação nova consome o evento enriquecido; ninguém cria segunda subscription do Notion nem reimplementa diff no n8n.

- [ ] **Step 2: Commit**

```bash
git add docs/n8n.md
git commit -m "docs: contrato e passo a passo da integracao n8n (fase 2)"
```

---

## Critérios de aceite da v1 (validação manual pós-deploy)

1. `npm test` e `npm run build` verdes; `docker build` completa.
2. Subscription do Notion ativada (handshake logado, token colado na UI).
3. Criar tarefa na database → embed em `Demandas-Adicionadas` e `Demandas-Historico`.
4. Mudar Status para "Em andamento" → embed em `Demandas-EmAndamento` e `Demandas-Atualizadas`.
5. Mudar Status para "Concluido" → embed em `Demandas-Finalizadas` com `from → to` correto.
6. Reenviar o mesmo evento (retry do Notion) → sem mensagem duplicada.
7. POST sem assinatura válida → 401 e nada enviado.
8. `git log` sem nenhum segredo/URL real (conferir antes do push).
