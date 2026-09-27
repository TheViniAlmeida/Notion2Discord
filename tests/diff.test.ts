import { describe, it, expect } from 'vitest';
import { diffProperties } from '../src/diff.js';

const base = { id: 'p1', url: 'u', title: 't', properties: {} };

describe('diffProperties', () => {
  it('reports changed properties with from/to', () => {
    const prev = { ...base, properties: { Status: 'Não iniciada', Prio: null } };
    const next = { ...base, properties: { Status: 'Concluido', Prio: null } };
    expect(diffProperties(prev, next)).toEqual([
      { property: 'Status', from: 'Não iniciada', to: 'Concluido' },
    ]);
  });
  it('treats a new page (null prev) as all-from-null', () => {
    const next = { ...base, properties: { Status: 'Não iniciada', Prio: null } };
    expect(diffProperties(null, next)).toEqual([
      { property: 'Status', from: null, to: 'Não iniciada' },
    ]);
  });
  it('reports properties removed from the schema', () => {
    const prev = { ...base, properties: { Old: 'x' } };
    const next = { ...base, properties: {} };
    expect(diffProperties(prev, next)).toEqual([{ property: 'Old', from: 'x', to: null }]);
  });
});
