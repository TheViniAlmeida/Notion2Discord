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
