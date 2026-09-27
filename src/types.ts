export type NotionEvent = {
  id: string;
  timestamp: string;
  type: string;
  entity: { id: string; type: string };
  data?: {
    parent?: { id: string; type: string };
    updated_properties?: string[];
  };
};

export type NormalizedPage = {
  id: string;
  url: string;
  title: string;
  properties: Record<string, string | null>;
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
};
