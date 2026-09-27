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
  it('fails when a when clause has no operator', () => {
    const bad = yamlOk.replace('send_to: [historico]', 'when: { property: "Status" }\n    send_to: [historico]');
    expect(() => loadConfig(bad, { WH_HIST: 'x', N8N_URL: 'y' })).toThrow(/operator/);
  });
});
