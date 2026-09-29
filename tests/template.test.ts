import { describe, it, expect } from 'vitest';
import { renderString, renderEmbed, renderMessage } from '../src/template.js';
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
      .toBe('**Status:** Em andamento → **Concluido**\n**Prazo:** — → **2026-09-30**');
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

describe('mentions', () => {
  const withPeople: EnrichedEvent = {
    ...event,
    page: {
      ...event.page,
      people: {
        Atribuido: [
          { name: 'Ana', email: 'ana@example.com', discordId: '100000000000000001' },
          { name: 'Bia', email: null },
        ],
      },
    },
  };
  it('renders {{mention.X}} as discord mentions, falling back to the name', () => {
    expect(renderString('{{mention.Atribuido}}', withPeople, rule)).toBe('<@100000000000000001>, Bia');
    expect(renderString('{{mention.Nada}}', withPeople, rule)).toBe('—');
  });
  it('falls back to the plain property when the page has no people (snapshot)', () => {
    expect(renderString('{{mention.Atribuido}}', event, rule)).toBe('Hades');
    expect(renderString('{{person.Atribuido}}', event, rule)).toBe('Hades');
  });
  it('renders {{person.X}} as plain "Name (id)" text, without the mention chip', () => {
    expect(renderString('{{person.Atribuido}}', withPeople, rule)).toBe('Ana (100000000000000001), Bia');
    expect(renderString('{{person.Nada}}', withPeople, rule)).toBe('—');
  });
  it('renders the event authors, and never pings them without a mention list', () => {
    const byAna: EnrichedEvent = {
      ...event,
      authors: [{ name: 'Ana', email: null, discordId: '100000000000000001' }],
    };
    expect(renderString('{{mention.event.authors}}', byAna, rule)).toBe('<@100000000000000001>');
    expect(renderString('{{person.event.authors}}', byAna, rule)).toBe('Ana (100000000000000001)');
    expect(renderString('{{mention.event.authors}}', event, rule)).toBe('—');
    expect(renderMessage({ title: '{{mention.event.authors}}' }, byAna, rule).content).toBeUndefined();
    expect(renderMessage({ title: 'x' }, byAna, { ...rule, mention: ['event.authors'] }).content)
      .toBe('<@100000000000000001>');
  });
  it('pings only the mapped people of the rule mention list', () => {
    const msg = renderMessage({ title: '{{page.title}}' }, withPeople, { ...rule, mention: ['Atribuido'] });
    expect(msg.content).toBe('<@100000000000000001>');
    expect(msg.allowed_mentions).toEqual({ parse: [], users: ['100000000000000001'] });
    expect(msg.embeds[0]!.title).toBe('Pacote FLA');
  });
  it('sends no content and blocks every ping without a mention list', () => {
    const msg = renderMessage({ title: '@everyone {{page.title}}' }, withPeople, rule);
    expect(msg.content).toBeUndefined();
    expect(msg.allowed_mentions).toEqual({ parse: [], users: [] });
  });
});

describe('comment placeholders', () => {
  const withComment: EnrichedEvent = {
    ...event,
    type: 'comment.created',
    changes: [],
    comment: {
      text: 'veja isso',
      author: { name: 'Bia', email: null },
      mentions: [{ name: 'Ana', email: 'ana@example.com', discordId: '100000000000000001' }],
    },
  };
  it('renders comment text and author/mentions', () => {
    expect(renderString('{{comment.text}}', withComment, rule)).toBe('veja isso');
    expect(renderString('{{mention.comment.author}}', withComment, rule)).toBe('Bia');
    expect(renderString('{{mention.comment.mentions}}', withComment, rule)).toBe('<@100000000000000001>');
    expect(renderString('{{comment.text}}', event, rule)).toBe('—');
  });
  it('pings the people mentioned in the comment', () => {
    const msg = renderMessage({ title: 't' }, withComment, { ...rule, mention: ['comment.mentions', 'comment.author'] });
    expect(msg.content).toBe('<@100000000000000001>');
  });
});

describe('rich embeds', () => {
  const rich: EnrichedEvent = {
    ...event,
    page: {
      ...event.page,
      properties: { ...event.page.properties, 'Esforço necessário': 'Alto' },
      people: { 'Criado por': [{ name: 'Ana', email: null, discordId: '100000000000000001' }] },
    },
  };
  it('renders author, thumbnail, image and footer with placeholders', () => {
    const embed = renderEmbed(
      {
        author: { name: '🆕 {{event.label}}', icon_url: 'https://example.com/i.png' },
        thumbnail: { url: 'https://example.com/logo.png' },
        image: { url: 'https://example.com/line.gif' },
        footer: { text: 'ID {{prop.Status}}', icon_url: 'https://example.com/i.png' },
      },
      rich,
      rule,
    );
    expect(embed.author).toEqual({ name: '🆕 Tarefa atualizada', icon_url: 'https://example.com/i.png' });
    expect(embed.thumbnail).toEqual({ url: 'https://example.com/logo.png' });
    expect(embed.image).toEqual({ url: 'https://example.com/line.gif' });
    expect(embed.footer).toEqual({ text: 'ID Concluido', icon_url: 'https://example.com/i.png' });
  });
  it('drops image and icon fields whose URL is not http(s)', () => {
    const embed = renderEmbed(
      { thumbnail: { url: '{{prop.Capa}}' }, image: { url: 'not a url' }, footer: { text: 'x', icon_url: '{{prop.Nada}}' } },
      rich,
      rule,
    );
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.image).toBeUndefined();
    expect(embed.footer).toEqual({ text: 'x' });
  });
  it('ignores inherited object keys in placeholders', () => {
    expect(renderString('{{prop.toString}}|{{mention.toString}}', rich, rule)).toBe('—|—');
  });
  it('accepts keys with spaces and accents', () => {
    expect(renderString('{{prop.Esforço necessário}} / {{ mention.Criado por }}', rich, rule))
      .toBe('Alto / <@100000000000000001>');
  });
});
