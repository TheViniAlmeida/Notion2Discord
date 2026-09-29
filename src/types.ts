export type NotionEvent = {
  id: string;
  timestamp: string;
  type: string;
  entity: { id: string; type: string };
  data?: {
    parent?: { id: string; type: string };
    page_id?: string; // comment.* events
    updated_properties?: string[];
  };
};

export type PagePerson = { name: string; email: string | null; discordId?: string };

export type NormalizedPage = {
  id: string;
  url: string;
  title: string;
  properties: Record<string, string | null>;
  // People properties with e-mails, for mentions. In memory only: never persisted.
  people?: Record<string, PagePerson[]>;
  // Database the page belongs to; resolves the source of comment events.
  parentDatabaseId?: string | null;
};

export type CommentInfo = {
  text: string;
  author: PagePerson;
  mentions: PagePerson[];
};

export type PropertyChange = {
  property: string;
  from: string | null;
  to: string | null;
};

export type EnrichedEvent = {
  type: string;
  label: string;
  sourceKey: string;
  page: NormalizedPage;
  changes: PropertyChange[];
  timestamp: string;
  comment?: CommentInfo;
};
