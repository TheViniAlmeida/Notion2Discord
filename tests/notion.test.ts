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
    Pessoas: { type: 'people', people: [{ name: 'Marcos', person: { email: 'Marcos@Example.com' } }, { name: 'Bot' }] },
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
      Pessoas: 'Marcos, Bot',
      Nota: null,
      Link: null,
    });
  });
});

describe('normalizePage created_by / last_edited_by', () => {
  it('treats them as single-person, mentionable properties', () => {
    const page = normalizePage({
      id: 'p',
      properties: {
        'Criado por': { type: 'created_by', created_by: { name: 'Ana', person: { email: 'Ana@Example.com' } } },
        'Editado por': { type: 'last_edited_by', last_edited_by: { name: 'Bia' } },
      },
    });
    expect(page.properties).toEqual({ 'Criado por': 'Ana', 'Editado por': 'Bia' });
    expect(page.people).toEqual({
      'Criado por': [{ name: 'Ana', email: 'ana@example.com' }],
      'Editado por': [{ name: 'Bia', email: null }],
    });
  });
});

describe('normalizePage people', () => {
  it('keeps people with lowercased e-mails for mentions', () => {
    expect(normalizePage(rawPage).people).toEqual({
      Pessoas: [
        { name: 'Marcos', email: 'marcos@example.com' },
        { name: 'Bot', email: null },
      ],
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

describe('NotionClient.fetchComment', () => {
  const comment = {
    id: 'c1',
    created_by: { object: 'user', id: 'u-author' },
    display_name: { type: 'user', resolved_name: 'Autor Nome' },
    rich_text: [
      { type: 'text', plain_text: 'Olha isso ' },
      { type: 'mention', plain_text: '@Ana', mention: { type: 'user', user: { object: 'user', id: 'u-ana' } } },
      { type: 'text', plain_text: ' e ' },
      { type: 'mention', plain_text: '@Ana', mention: { type: 'user', user: { object: 'user', id: 'u-ana' } } },
    ],
  };
  const fetchFn = (async (url: any) => {
    const u = String(url);
    if (u.endsWith('/comments/c1')) return new Response(JSON.stringify(comment), { status: 200 });
    if (u.endsWith('/users/u-ana'))
      return new Response(JSON.stringify({ name: 'Ana', person: { email: 'Ana@Example.com' } }), { status: 200 });
    return new Response('forbidden', { status: 403 });
  }) as typeof fetch;

  it('returns text, author and deduplicated mentions with e-mails from /users', async () => {
    const c = await new NotionClient('tok', fetchFn).fetchComment('c1');
    expect(c.text).toBe('Olha isso @Ana e @Ana');
    expect(c.mentions).toEqual([{ name: 'Ana', email: 'ana@example.com' }]);
  });
  it('falls back to the display name when the author cannot be read', async () => {
    const c = await new NotionClient('tok', fetchFn).fetchComment('c1');
    expect(c.author).toEqual({ name: 'Autor Nome', email: null });
  });
  it('propagates a rate limit on /users so the queue retries', async () => {
    const limited = (async (url: any) =>
      String(url).endsWith('/comments/c1')
        ? new Response(JSON.stringify(comment), { status: 200 })
        : new Response('slow down', { status: 429 })) as typeof fetch;
    await expect(new NotionClient('tok', limited).fetchComment('c1')).rejects.toThrow(/429/);
  });
  it('throws when the comment itself cannot be fetched', async () => {
    await expect(new NotionClient('tok', fetchFn).fetchComment('missing')).rejects.toThrow(/403/);
  });
});

describe('normalizePage parent', () => {
  it('exposes the parent database id', () => {
    const page = normalizePage({ id: 'p', parent: { type: 'data_source_id', data_source_id: 'ds', database_id: 'db1' }, properties: {} });
    expect(page.parentDatabaseId).toBe('db1');
  });
});
