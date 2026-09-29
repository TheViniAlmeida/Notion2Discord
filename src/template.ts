import type { EmbedTemplate, Rule } from './config.js';
import type { EnrichedEvent, PagePerson, PropertyChange } from './types.js';

export type DiscordEmbed = {
  author?: { name: string; url?: string; icon_url?: string };
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
};

export type DiscordMessage = {
  content?: string;
  embeds: DiscordEmbed[];
  allowed_mentions: { parse: string[]; users: string[] };
};

const EMPTY = '—';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// People behind a mention key: comment.author, comment.mentions or a page property.
function peopleFor(event: EnrichedEvent, key: string): PagePerson[] | undefined {
  if (key === 'comment.author') return event.comment ? [event.comment.author] : undefined;
  if (key === 'comment.mentions') return event.comment?.mentions;
  const people = event.page.people;
  return people && Object.hasOwn(people, key) ? people[key] : undefined;
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
  // Keys may hold spaces and accents: {{prop.Esforço necessário}}, {{mention.Criado por}}.
  return tpl.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, key: string) => {
    if (key === 'page.title') return event.page.title || EMPTY;
    if (key === 'page.url') return event.page.url || EMPTY;
    if (key === 'page.id') return event.page.id;
    if (key === 'event.type') return event.type;
    if (key === 'event.label') return event.label;
    if (key === 'change.from') return change?.from ?? EMPTY;
    if (key === 'change.to') return change?.to ?? EMPTY;
    if (key === 'changes.summary') return changesSummary(event);
    if (key === 'comment.text') return event.comment?.text || EMPTY;
    if (key.startsWith('prop.')) {
      const name = key.slice(5);
      return Object.hasOwn(event.page.properties, name) ? event.page.properties[name] ?? EMPTY : EMPTY;
    }
    if (key.startsWith('mention.')) {
      const prop = key.slice(8);
      const people = peopleFor(event, prop);
      // Snapshots (page.deleted) have no people: fall back to the plain names.
      if (!people) return renderString(`{{prop.${prop}}}`, event, rule);
      if (people.length === 0) return EMPTY;
      return people.map((p) => (p.discordId ? `<@${p.discordId}>` : p.name)).join(', ');
    }
    return EMPTY;
  });
}

export function renderEmbed(
  tpl: EmbedTemplate,
  event: EnrichedEvent,
  rule: Rule,
): DiscordEmbed {
  const r = (s: string) => renderString(s, event, rule);
  // Discord rejects the whole message on a bad image URL: drop the field instead.
  const link = (s: string) => {
    const url = r(s);
    return /^https?:\/\/\S+$/.test(url) ? url : undefined;
  };
  const embed: DiscordEmbed = { timestamp: event.timestamp };
  if (tpl.author) {
    embed.author = { name: truncate(r(tpl.author.name), 256) };
    const url = tpl.author.url && link(tpl.author.url);
    const icon = tpl.author.icon_url && link(tpl.author.icon_url);
    if (url) embed.author.url = url;
    if (icon) embed.author.icon_url = icon;
  }
  const thumb = tpl.thumbnail && link(tpl.thumbnail.url);
  if (thumb) embed.thumbnail = { url: thumb };
  const image = tpl.image && link(tpl.image.url);
  if (image) embed.image = { url: image };
  if (tpl.footer) {
    embed.footer = { text: truncate(r(tpl.footer.text), 2048) };
    const icon = tpl.footer.icon_url && link(tpl.footer.icon_url);
    if (icon) embed.footer.icon_url = icon;
  }
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

export function mentionIds(rule: Rule, event: EnrichedEvent): string[] {
  const ids = (rule.mention ?? []).flatMap((key) =>
    (peopleFor(event, key) ?? []).map((p) => p.discordId),
  );
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function renderMessage(tpl: EmbedTemplate, event: EnrichedEvent, rule: Rule): DiscordMessage {
  const users = mentionIds(rule, event);
  // parse: [] disables @everyone/@here/role pings from page text; only listed users are pinged.
  const message: DiscordMessage = {
    embeds: [renderEmbed(tpl, event, rule)],
    allowed_mentions: { parse: [], users },
  };
  if (users.length > 0) message.content = users.map((id) => `<@${id}>`).join(' ');
  return message;
}
