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
  it('parses people with lowercased e-mails and a rule mention list', () => {
    const y = yamlOk
      .replace('send_to: [historico]', 'send_to: [historico]\n    mention: [Atribuido]')
      + 'people:\n  "Ana@Example.com": "100000000000000001"\n';
    const cfg = loadConfig(y, { WH_HIST: 'x', N8N_URL: 'y' });
    expect(cfg.people).toEqual({ 'ana@example.com': '100000000000000001' });
    expect(cfg.rules[0]!.mention).toEqual(['Atribuido']);
  });
  it('defaults people to an empty map', () => {
    expect(loadConfig(yamlOk, { WH_HIST: 'x', N8N_URL: 'y' }).people).toEqual({});
  });
  it('rejects a discord id that is not a snowflake', () => {
    const y = yamlOk + 'people:\n  "a@example.com": "not-an-id"\n';
    expect(() => loadConfig(y, { WH_HIST: 'x', N8N_URL: 'y' })).toThrow(/17-20 digits/);
  });
  it('merges embed_defaults into every rule embed, rule keys winning', () => {
    const y = yamlOk.replace('embed: { title: "{{page.title}}" }', 'embed: { title: "{{page.title}}", color: "#000000" }')
      + 'embed_defaults:\n  color: "#FFFFFF"\n  thumbnail: { url: "https://example.com/logo.png" }\n  footer: { text: "LabForge" }\n';
    const embed = loadConfig(y, { WH_HIST: 'x', N8N_URL: 'y' }).rules[0]!.embed!;
    expect(embed).toEqual({
      title: '{{page.title}}',
      color: '#000000',
      thumbnail: { url: 'https://example.com/logo.png' },
      footer: { text: 'LabForge' },
    });
  });
  it('fails when a when clause has no operator', () => {
    const bad = yamlOk.replace('send_to: [historico]', 'when: { property: "Status" }\n    send_to: [historico]');
    expect(() => loadConfig(bad, { WH_HIST: 'x', N8N_URL: 'y' })).toThrow(/operator/);
  });
});
