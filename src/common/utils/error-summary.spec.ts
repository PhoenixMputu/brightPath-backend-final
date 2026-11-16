import { errorSummary } from './error-summary.js';

describe('errorSummary', () => {
  it('keeps the name and code, never the message', () => {
    const err = Object.assign(new TypeError('secret value'), { code: 'P1001' });
    expect(errorSummary(err)).toEqual({ type: 'TypeError', code: 'P1001' });
    expect(JSON.stringify(errorSummary(err))).not.toContain('secret');
  });

  it('handles errors without code and non-errors', () => {
    expect(errorSummary(new Error('x'))).toEqual({ type: 'Error' });
    expect(errorSummary('boom')).toEqual({ type: 'string' });
  });
});
