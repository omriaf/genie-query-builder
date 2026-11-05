import { describe, expect, it, vi } from 'vitest';

import { writeSseSafely } from './sse-response';

describe('writeSseSafely', () => {
  it('suppresses a disconnected-client write error so later work continues', () => {
    const end = vi.fn();
    const response = { write: vi.fn(() => { throw new Error('EPIPE'); }), end };

    expect(writeSseSafely(response, ['data: phase\n\n'])).toBe(false);
    expect(end).not.toHaveBeenCalled();
  });

  it('writes every chunk and ends a completed response', () => {
    const response = { write: vi.fn(), end: vi.fn() };

    expect(writeSseSafely(response, ['data: complete\n\n', 'data: [DONE]\n\n'], true)).toBe(true);
    expect(response.write.mock.calls).toEqual([
      ['data: complete\n\n'],
      ['data: [DONE]\n\n'],
    ]);
    expect(response.end).toHaveBeenCalledOnce();
  });
});
