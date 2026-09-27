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
