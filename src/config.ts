import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const whenSchema = z.object({
  property: z.string(),
  changed_to: z.string().optional(),
  changed_from: z.string().optional(),
  equals: z.string().optional(),
  changed: z.boolean().optional(),
}).refine(
  (w) =>
    w.changed_to !== undefined ||
    w.changed_from !== undefined ||
    w.equals !== undefined ||
    w.changed !== undefined,
  { message: 'when needs at least one operator (changed_to, changed_from, equals, changed)' },
);

const embedFieldSchema = z.object({
  name: z.string(),
  value: z.string(),
  inline: z.boolean().optional(),
});

const embedSchema = z.object({
  author: z.object({ name: z.string().min(1), url: z.string().optional(), icon_url: z.string().optional() }).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fields: z.array(embedFieldSchema).optional(),
  thumbnail: z.object({ url: z.string() }).optional(),
  image: z.object({ url: z.string() }).optional(),
  footer: z.object({ text: z.string().min(1), icon_url: z.string().optional() }).optional(),
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
      // People properties whose members get pinged (message content, outside the embed).
      mention: z.array(z.string()).optional(),
      // Properties this rule never sees as changes (summary, when, change.*).
      ignore: z.array(z.string()).optional(),
    }),
  ),
  labels: z.record(z.string(), z.string()).optional(),
  // Shared look (thumbnail, image, footer...): each rule embed overrides key by key.
  embed_defaults: embedSchema.optional(),
  // Notion e-mail -> Discord user id. Personal data: keep it in the host-only rules.yaml.
  people: z.record(z.string(), z.string().regex(/^\d{17,20}$/, 'discord user id must be 17-20 digits')).optional(),
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
  people: Record<string, string>;
};

const DEFAULT_LABELS: Record<string, string> = {
  'page.created': 'Tarefa criada',
  'page.properties_updated': 'Tarefa atualizada',
  'page.content_updated': 'Conteúdo atualizado',
  'page.deleted': 'Tarefa removida',
  'page.undeleted': 'Tarefa restaurada',
  'comment.created': 'Novo comentário',
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

  const defaults = raw.embed_defaults ?? {};
  const rules = raw.rules.map((rule) =>
    rule.embed ? { ...rule, embed: { ...defaults, ...rule.embed } } : rule,
  );

  return {
    sources: raw.sources,
    targets,
    rules,
    labels: { ...DEFAULT_LABELS, ...raw.labels },
    people: Object.fromEntries(
      Object.entries(raw.people ?? {}).map(([email, id]) => [email.toLowerCase(), id]),
    ),
  };
}

export function loadConfigFromFile(path: string, env: NodeJS.ProcessEnv): AppConfig {
  return loadConfig(readFileSync(path, 'utf8'), env);
}
