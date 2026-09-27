import type { NormalizedPage, PropertyChange } from './types.js';

export function diffProperties(
  prev: NormalizedPage | null,
  next: NormalizedPage,
): PropertyChange[] {
  const prevProps = prev?.properties ?? {};
  const changes: PropertyChange[] = [];
  const names = new Set([...Object.keys(prevProps), ...Object.keys(next.properties)]);
  for (const name of names) {
    const from = prevProps[name] ?? null;
    const to = next.properties[name] ?? null;
    if (from !== to) changes.push({ property: name, from, to });
  }
  return changes;
}
