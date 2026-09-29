import type { NormalizedPage, PagePerson } from './types.js';

const NOTION_VERSION = '2025-09-03';
const API_BASE = 'https://api.notion.com/v1';

type RichTextItem = { plain_text: string };
type NotionUser = { name?: string; person?: { email?: string } };

// Property types whose value is one or more Notion users (mentionable).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function usersOf(prop: any): NotionUser[] | null {
  if (prop?.type === 'people') return prop.people ?? [];
  if (prop?.type === 'created_by') return prop.created_by ? [prop.created_by] : [];
  if (prop?.type === 'last_edited_by') return prop.last_edited_by ? [prop.last_edited_by] : [];
  return null;
}

function joinRichText(items: RichTextItem[] | undefined): string | null {
  const text = (items ?? []).map((i) => i.plain_text).join('');
  return text === '' ? null : text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeProperty(prop: any): string | null {
  switch (prop?.type) {
    case 'title':
      return joinRichText(prop.title);
    case 'rich_text':
      return joinRichText(prop.rich_text);
    case 'status':
      return prop.status?.name ?? null;
    case 'select':
      return prop.select?.name ?? null;
    case 'multi_select':
      return prop.multi_select?.length
        ? prop.multi_select.map((o: { name: string }) => o.name).join(', ')
        : null;
    case 'date':
      return prop.date?.start ?? null;
    case 'checkbox':
      return String(prop.checkbox);
    case 'number':
      return prop.number === null || prop.number === undefined ? null : String(prop.number);
    case 'people':
    case 'created_by':
    case 'last_edited_by': {
      const users = usersOf(prop)!;
      return users.length ? users.map((u) => u.name ?? 'unknown').join(', ') : null;
    }
    case 'url':
      return prop.url ?? null;
    case 'email':
      return prop.email ?? null;
    case 'phone_number':
      return prop.phone_number ?? null;
    case 'unique_id':
      return prop.unique_id ? `${prop.unique_id.prefix ?? ''}${prop.unique_id.number}` : null;
    default:
      return null; // formula, relation, rollup etc.: out of scope in v1
  }
}

export function normalizePage(raw: unknown): NormalizedPage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = raw as any;
  const properties: Record<string, string | null> = {};
  const people: Record<string, PagePerson[]> = {};
  let title = '';
  for (const [name, prop] of Object.entries(page.properties ?? {})) {
    const value = normalizeProperty(prop);
    properties[name] = value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prop as any;
    if (p?.type === 'title') title = value ?? '';
    const users = usersOf(p);
    if (users) {
      people[name] = users.map((u) => ({
        name: u.name ?? 'unknown',
        email: u.person?.email?.toLowerCase() ?? null,
      }));
    }
  }
  return { id: page.id, url: page.url ?? '', title, properties, people };
}

export class NotionClient {
  constructor(
    private token: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async fetchPage(pageId: string): Promise<NormalizedPage> {
    const res = await this.fetchFn(`${API_BASE}/pages/${encodeURIComponent(pageId)}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
      },
    });
    if (!res.ok) throw new Error(`Notion API error ${res.status} fetching page`);
    return normalizePage(await res.json());
  }
}
