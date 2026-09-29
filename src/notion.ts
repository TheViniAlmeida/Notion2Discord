import type { CommentInfo, NormalizedPage, PagePerson } from './types.js';

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
  return {
    id: page.id,
    url: page.url ?? '',
    title,
    properties,
    people,
    parentDatabaseId: page.parent?.database_id ?? null,
  };
}

export class NotionApiError extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`Notion API error ${status} fetching ${what}`);
  }
}

export class NotionClient {
  constructor(
    private token: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private async get(path: string, what: string): Promise<unknown> {
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
      },
    });
    if (!res.ok) throw new NotionApiError(res.status, what);
    return res.json();
  }

  async fetchPage(pageId: string): Promise<NormalizedPage> {
    return normalizePage(await this.get(`/pages/${encodeURIComponent(pageId)}`, 'page'));
  }

  // Comment payloads carry only user ids: name and e-mail come from /users.
  // A user the integration cannot read keeps the fallback name and gets no mention;
  // rate limits and outages propagate so the queue retries instead of dropping the ping.
  private async fetchUser(userId: string, fallbackName: string): Promise<PagePerson> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = (await this.get(`/users/${encodeURIComponent(userId)}`, 'user')) as any;
      return { name: u.name ?? fallbackName, email: u.person?.email?.toLowerCase() ?? null };
    } catch (err) {
      if (err instanceof NotionApiError && (err.status === 429 || err.status >= 500)) throw err;
      return { name: fallbackName, email: null };
    }
  }

  async fetchComment(commentId: string): Promise<CommentInfo> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (await this.get(`/comments/${encodeURIComponent(commentId)}`, 'comment')) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const richText: any[] = c.rich_text ?? [];
    const mentioned = new Map<string, string>();
    for (const item of richText) {
      if (item?.type === 'mention' && item.mention?.type === 'user' && item.mention.user?.id) {
        const name = String(item.plain_text ?? '').replace(/^@/, '') || 'unknown';
        mentioned.set(item.mention.user.id, name);
      }
    }
    const author = await this.fetchUser(
      c.created_by?.id ?? '',
      c.display_name?.resolved_name ?? 'unknown',
    );
    const mentions: PagePerson[] = [];
    for (const [id, name] of mentioned) mentions.push(await this.fetchUser(id, name));
    return { text: joinRichText(richText) ?? '', author, mentions };
  }
}
