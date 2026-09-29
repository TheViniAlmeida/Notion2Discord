import { describe, it, expect } from 'vitest';
import { SnapshotStore } from '../src/store.js';

const page = {
  id: 'p1',
  url: 'https://notion.so/p1',
  title: 'Task A',
  properties: { Status: 'Não iniciada' },
};

describe('SnapshotStore', () => {
  it('dedups events', () => {
    const s = new SnapshotStore(':memory:');
    expect(s.seenEvent('ev1')).toBe(false);
    expect(s.seenEvent('ev1')).toBe(true);
    expect(s.seenEvent('ev2')).toBe(false);
    s.close();
  });
  it('round-trips snapshots and returns null for unknown pages', () => {
    const s = new SnapshotStore(':memory:');
    expect(s.getSnapshot('p1')).toBeNull();
    s.saveSnapshot(page);
    expect(s.getSnapshot('p1')).toEqual(page);
    s.saveSnapshot({ ...page, properties: { Status: 'Concluido' } });
    expect(s.getSnapshot('p1')!.properties['Status']).toBe('Concluido');
    s.close();
  });
  it('never persists people (e-mails)', () => {
    const s = new SnapshotStore(':memory:');
    s.saveSnapshot({ ...page, people: { Atribuido: [{ name: 'A', email: 'a@example.com' }] } });
    expect(s.getSnapshot('p1')).toEqual(page);
    s.close();
  });
});
