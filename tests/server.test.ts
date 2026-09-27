import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildServer } from '../src/server.js';

const token = 'secret_tok';
const sign = (body: string) =>
  'sha256=' + createHmac('sha256', token).update(body).digest('hex');

const event = {
  id: 'ev1',
  timestamp: 't',
  type: 'page.created',
  entity: { id: 'p1', type: 'page' },
};

function makeApp(overrides?: Partial<Parameters<typeof buildServer>[0]>) {
  return buildServer({
    verificationToken: token,
    seenEvent: () => false,
    enqueue: vi.fn(),
    ...overrides,
  });
}

describe('POST /webhook/notion', () => {
  it('accepts a signed event and enqueues it', async () => {
    const enqueue = vi.fn();
    const app = makeApp({ enqueue });
    const body = JSON.stringify(event);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-notion-signature': sign(body) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'accepted' });
    expect(enqueue).toHaveBeenCalledWith(event);
  });
  it('rejects an invalid signature with 401', async () => {
    const enqueue = vi.fn();
    const app = makeApp({ enqueue });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: JSON.stringify(event),
      headers: { 'content-type': 'application/json', 'x-notion-signature': 'sha256=deadbeef' },
    });
    expect(res.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('answers 200 to the verification handshake without a signature', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: JSON.stringify({ verification_token: 'secret_vt_abcdef123' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
  });
  it('hands the full verification token to onVerificationToken', async () => {
    const onVerificationToken = vi.fn();
    const app = makeApp({ onVerificationToken, verificationToken: '' });
    await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: JSON.stringify({ verification_token: 'secret_vt_abcdef123' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(onVerificationToken).toHaveBeenCalledWith('secret_vt_abcdef123');
  });
  it('rejects every event while no verification token is configured', async () => {
    const enqueue = vi.fn();
    const app = makeApp({ enqueue, verificationToken: '' });
    const body = JSON.stringify(event);
    const forged = 'sha256=' + createHmac('sha256', '').update(body).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-notion-signature': forged },
    });
    expect(res.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('ignores the handshake once a verification token is configured', async () => {
    const onVerificationToken = vi.fn();
    const app = makeApp({ onVerificationToken });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: JSON.stringify({ verification_token: 'attacker_value' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(onVerificationToken).not.toHaveBeenCalled();
  });
  it('rejects a non-object JSON body with 400', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: 'null',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });
  it('rejects a signed payload missing required event fields with 400', async () => {
    const enqueue = vi.fn();
    const seenEvent = vi.fn(() => false);
    const app = makeApp({ enqueue, seenEvent });
    const body = JSON.stringify({ type: 'page.created' });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-notion-signature': sign(body) },
    });
    expect(res.statusCode).toBe(400);
    expect(seenEvent).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('accepts application/json with a charset parameter', async () => {
    const enqueue = vi.fn();
    const app = makeApp({ enqueue });
    const body = JSON.stringify(event);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: body,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-notion-signature': sign(body) },
    });
    expect(res.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledOnce();
  });
  it('acknowledges duplicates without enqueueing', async () => {
    const enqueue = vi.fn();
    const app = makeApp({ enqueue, seenEvent: () => true });
    const body = JSON.stringify(event);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/notion',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-notion-signature': sign(body) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'duplicate' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('GET /healthz', () => {
  it('returns ok', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });
});
