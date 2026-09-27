import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/signature.js';

const token = 'secret_test_token';
const body = JSON.stringify({ hello: 'world' });
const goodSig = 'sha256=' + createHmac('sha256', token).update(body).digest('hex');

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    expect(verifySignature(body, goodSig, token)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifySignature(body + 'x', goodSig, token)).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(verifySignature(body, undefined, token)).toBe(false);
  });
  it('rejects a malformed header without crashing', () => {
    expect(verifySignature(body, 'not-a-signature', token)).toBe(false);
  });
});
