import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(
  rawBody: string,
  header: string | undefined,
  token: string,
): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', token).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
