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
