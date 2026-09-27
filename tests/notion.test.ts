import { describe, it, expect } from 'vitest';
import { normalizePage, NotionClient } from '../src/notion.js';

const rawPage = {
  id: 'page-1',
  url: 'https://www.notion.so/page-1',
  properties: {
    Name: { type: 'title', title: [{ plain_text: 'Colocar pacote ' }, { plain_text: 'FLA' }] },
    Status: { type: 'status', status: { name: 'Concluido' } },
    Atribuido: { type: 'select', select: { name: 'Hades' } },
    Tags: { type: 'multi_select', multi_select: [{ name: 'infra' }, { name: 'urgente' }] },
    Prazo: { type: 'date', date: { start: '2026-09-30' } },
    Feito: { type: 'checkbox', checkbox: false },
    ID: { type: 'number', number: 30 },
    Pessoas: { type: 'people', people: [{ name: 'Marcos' }] },
    Nota: { type: 'rich_text', rich_text: [] },
    Link: { type: 'url', url: null },
  },
};

describe('normalizePage', () => {
  it('flattens every supported property type to plain text', () => {
    const page = normalizePage(rawPage);
    expect(page.id).toBe('page-1');
    expect(page.title).toBe('Colocar pacote FLA');
    expect(page.properties).toEqual({
      Name: 'Colocar pacote FLA',
      Status: 'Concluido',
      Atribuido: 'Hades',
      Tags: 'infra, urgente',
      Prazo: '2026-09-30',
      Feito: 'false',
      ID: '30',
      Pessoas: 'Marcos',
      Nota: null,
      Link: null,
    });
  });
});

describe('NotionClient', () => {
  it('fetches and normalizes a page', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify(rawPage), { status: 200 })) as typeof fetch;
    const client = new NotionClient('tok', fetchFn);
    const page = await client.fetchPage('page-1');
    expect(page.title).toBe('Colocar pacote FLA');
  });
  it('throws with the HTTP status on failure', async () => {
    const fetchFn = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    const client = new NotionClient('tok', fetchFn);
    await expect(client.fetchPage('missing')).rejects.toThrow(/404/);
  });
});
