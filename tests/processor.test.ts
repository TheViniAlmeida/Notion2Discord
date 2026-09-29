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
  people: { 'ana@example.com': '100000000000000001' },
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
    const [target1, event1, message1] = send.mock.calls[0]!;
    expect(target1).toEqual(cfg.targets['done']);
    expect(event1.changes).toEqual([
      { property: 'Status', from: 'Em andamento', to: 'Concluido' },
    ]);
    expect(message1!.embeds[0]).toMatchObject({ title: '✅ Pacote FLA' });
    expect(store.getSnapshot('p1')!.properties['Status']).toBe('Concluido');
    store.close();
  });
  it('resolves discord ids by e-mail and pings the people of mention properties', async () => {
    const store = new SnapshotStore(':memory:');
    store.saveSnapshot({ ...pageV2, properties: { Status: 'Em andamento' } });
    const send = vi.fn(async () => {});
    const cfgMention: AppConfig = {
      ...cfg,
      rules: [{ ...cfg.rules[0]!, send_to: ['done'], mention: ['Atribuido'] }],
    };
    const page: NormalizedPage = {
      ...pageV2,
      people: {
        Atribuido: [
          { name: 'Ana', email: 'ana@example.com' },
          { name: 'Sem Mapa', email: 'nobody@example.com' },
        ],
      },
    };
    const proc = createProcessor({
      config: cfgMention,
      store,
      notion: { fetchPage: async () => page },
      send,
    });
    await proc(rawEvent);
    const message = send.mock.calls[0]![2]!;
    expect(message.content).toBe('<@100000000000000001>');
    expect(message.allowed_mentions).toEqual({ parse: [], users: ['100000000000000001'] });
    expect(store.getSnapshot('p1')).not.toHaveProperty('people');
    store.close();
  });
  it('delivers comment events pinging the mentioned people, without touching snapshots', async () => {
    const store = new SnapshotStore(':memory:');
    const send = vi.fn(async () => {});
    const cfgComment: AppConfig = {
      ...cfg,
      labels: { ...cfg.labels, 'comment.created': 'Novo comentário' },
      rules: [{
        name: 'comentario', source: 'demandas', on: ['comment.created'], send_to: ['done'],
        mention: ['comment.mentions'], embed: { title: '{{page.title}}', description: '{{comment.text}}' },
      }],
    };
    const fetchPage = vi.fn(async () => ({ ...pageV2, parentDatabaseId: 'aaaa-1111' }));
    const proc = createProcessor({
      config: cfgComment,
      store,
      notion: {
        fetchPage,
        fetchComment: async () => ({
          text: 'veja @Ana',
          author: { name: 'Bia', email: null },
          mentions: [{ name: 'Ana', email: 'ana@example.com' }],
        }),
      },
      send,
    });
    await proc({
      ...rawEvent,
      type: 'comment.created',
      entity: { id: 'c1', type: 'comment' },
      data: { page_id: 'p1', parent: { id: 'p1', type: 'page' } },
    });
    expect(fetchPage).toHaveBeenCalledWith('p1');
    const [, event, message] = send.mock.calls[0]!;
    expect(event.label).toBe('Novo comentário');
    expect(message!.content).toBe('<@100000000000000001>');
    expect(message!.embeds[0]!.description).toBe('veja @Ana');
    expect(store.getSnapshot('p1')).toBeNull();
    store.close();
  });
  it('discards comments on pages outside the sources and comment.deleted', async () => {
    const store = new SnapshotStore(':memory:');
    const send = vi.fn(async () => {});
    const fetchComment = vi.fn();
    const proc = createProcessor({
      config: { ...cfg, rules: [{ name: 'c', source: 'demandas', on: ['comment.created', 'comment.deleted'], send_to: ['feed'] }] },
      store,
      notion: { fetchPage: async () => ({ ...pageV2, parentDatabaseId: 'other' }), fetchComment },
      send,
    });
    const comment = { ...rawEvent, entity: { id: 'c1', type: 'comment' }, data: { page_id: 'p1' } };
    await proc({ ...comment, type: 'comment.created' });
    await proc({ ...comment, type: 'comment.deleted' });
    expect(fetchComment).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    store.close();
  });
  it('skips API calls for comment types no rule listens to', async () => {
    const store = new SnapshotStore(':memory:');
    const fetchPage = vi.fn();
    const send = vi.fn();
    const proc = createProcessor({
      config: cfg,
      store,
      notion: { fetchPage, fetchComment: vi.fn() },
      send,
    });
    await proc({ ...rawEvent, type: 'comment.updated', entity: { id: 'c1', type: 'comment' }, data: { page_id: 'p1' } });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    store.close();
  });
  it('without a snapshot, keeps only the properties the event says were updated', async () => {
    const store = new SnapshotStore(':memory:');
    const send = vi.fn(async () => {});
    const page: NormalizedPage = {
      ...pageV2,
      properties: { Status: 'Concluido', ID: '58', Demanda: 'Pacote FLA' },
      propertyIds: { Status: ':UPp', ID: 'abc', Demanda: 'title' },
    };
    const proc = createProcessor({
      config: cfg,
      store,
      notion: { fetchPage: async () => page, fetchComment: vi.fn() },
      send,
    });
    await proc({ ...rawEvent, data: { ...rawEvent.data!, updated_properties: ['%3AUPp'] } });
    expect(send.mock.calls[0]![1].changes).toEqual([{ property: 'Status', from: null, to: 'Concluido' }]);
    store.close();
  });
  it('without a snapshot nor updated_properties, keeps every filled property', async () => {
    const store = new SnapshotStore(':memory:');
    const send = vi.fn(async () => {});
    const page: NormalizedPage = { ...pageV2, properties: { Status: 'Concluido', ID: '58' }, propertyIds: { Status: 's', ID: 'i' } };
    const cfgAll: AppConfig = { ...cfg, rules: [{ name: 'upd', source: 'demandas', on: ['page.properties_updated'], send_to: ['feed'] }] };
    const proc = createProcessor({ config: cfgAll, store, notion: { fetchPage: async () => page, fetchComment: vi.fn() }, send });
    await proc({ ...rawEvent, data: { parent: rawEvent.data!.parent! } });
    expect(send.mock.calls[0]![1].changes.map((c) => c.property)).toEqual(['Status', 'ID']);
    store.close();
  });
  it('drops ignored properties and skips a rule left without changes', async () => {
    const store = new SnapshotStore(':memory:');
    store.saveSnapshot({ ...pageV2, properties: { Status: 'Concluido', 'Feito?': 'false' } });
    const send = vi.fn(async () => {});
    const cfgIgnore: AppConfig = {
      ...cfg,
      rules: [{ name: 'upd', source: 'demandas', on: ['page.properties_updated'], send_to: ['feed'], ignore: ['Feito?'] }],
    };
    const proc = createProcessor({
      config: cfgIgnore,
      store,
      notion: { fetchPage: async () => ({ ...pageV2, properties: { Status: 'Concluido', 'Feito?': 'true' } }), fetchComment: vi.fn() },
      send,
    });
    await proc(rawEvent);
    expect(send).not.toHaveBeenCalled();
    store.close();
  });
  it('a failing target does not block the others nor rethrow', async () => {
    const store = new SnapshotStore(':memory:');
    store.saveSnapshot({ ...pageV2, properties: { Status: 'Em andamento' } });
    const error = vi.fn();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('target responded 400'))
      .mockResolvedValueOnce(undefined);
    const proc = createProcessor({
      config: cfg,
      store,
      notion: { fetchPage: async () => pageV2 },
      send,
      log: { debug: () => {}, warn: () => {}, error },
    });
    await expect(proc(rawEvent)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledOnce();
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
  it('resolves event authors (people only, deduplicated) before delivering', async () => {
    const store = new SnapshotStore(':memory:');
    store.saveSnapshot({ ...pageV2, properties: { Status: 'Em andamento' } });
    const send = vi.fn(async () => {});
    const fetchUser = vi.fn(async () => ({ name: 'Ana', email: 'ana@example.com' }));
    const proc = createProcessor({
      config: cfg,
      store,
      notion: { fetchPage: async () => pageV2, fetchComment: vi.fn(), fetchUser },
      send,
    });
    await proc({
      ...rawEvent,
      authors: [{ id: 'u1', type: 'person' }, { id: 'u1', type: 'person' }, { id: 'b1', type: 'bot' }],
    });
    expect(fetchUser).toHaveBeenCalledOnce();
    expect(fetchUser).toHaveBeenCalledWith('u1', '');
    expect(send.mock.calls[0]![1].authors).toEqual([
      { name: 'Ana', email: 'ana@example.com', discordId: '100000000000000001' },
    ]);
    store.close();
  });
  it('leaves out authors the integration cannot read', async () => {
    const store = new SnapshotStore(':memory:');
    store.saveSnapshot({ ...pageV2, properties: { Status: 'Em andamento' } });
    const send = vi.fn(async () => {});
    const proc = createProcessor({
      config: cfg,
      store,
      notion: { fetchPage: async () => pageV2, fetchComment: vi.fn(), fetchUser: async () => ({ name: '', email: null }) },
      send,
    });
    await proc({ ...rawEvent, authors: [{ id: 'u9', type: 'person' }] });
    expect(send.mock.calls[0]![1].authors).toEqual([]);
    store.close();
  });
  it('skips the /users call when no rule matches', async () => {
    const store = new SnapshotStore(':memory:');
    store.saveSnapshot(pageV2); // same status: "done" rule does not match
    const fetchUser = vi.fn();
    const proc = createProcessor({
      config: cfg,
      store,
      notion: { fetchPage: async () => pageV2, fetchComment: vi.fn(), fetchUser },
      send: vi.fn(async () => {}),
    });
    await proc({ ...rawEvent, authors: [{ id: 'u1', type: 'person' }] });
    expect(fetchUser).not.toHaveBeenCalled();
    store.close();
  });
  it('keeps the old snapshot when /users fails, so the queue retry sees the same diff', async () => {
    const store = new SnapshotStore(':memory:');
    store.saveSnapshot({ ...pageV2, properties: { Status: 'Em andamento' } });
    const send = vi.fn(async () => {});
    const proc = createProcessor({
      config: cfg,
      store,
      notion: {
        fetchPage: async () => pageV2,
        fetchComment: vi.fn(),
        fetchUser: vi.fn(async () => { throw new Error('Notion API error 429 fetching user'); }),
      },
      send,
    });
    await expect(proc({ ...rawEvent, authors: [{ id: 'u1', type: 'person' }] })).rejects.toThrow(/429/);
    expect(store.getSnapshot('p1')!.properties['Status']).toBe('Em andamento');
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
