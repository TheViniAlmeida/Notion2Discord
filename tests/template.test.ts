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
