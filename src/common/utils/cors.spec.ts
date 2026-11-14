import { buildCorsOptions, parseCorsOrigins } from './cors.js';

describe('parseCorsOrigins', () => {
  it('parses a comma-separated list, trimming spaces and trailing slashes', () => {
    expect(
      parseCorsOrigins(' http://localhost:3000/ , https://app.brightpath.cd'),
    ).toEqual(['http://localhost:3000', 'https://app.brightpath.cd']);
  });

  it.each([undefined, '', ' , '])('throws when the value is %j', (value) => {
    expect(() => parseCorsOrigins(value)).toThrow(/at least one/);
  });

  it.each(['*', 'localhost:3000', 'http://localhost:3000/login'])(
    'rejects %j, which is not a plain origin',
    (value) => {
      expect(() => parseCorsOrigins(value)).toThrow(/invalid origin/);
    },
  );
});

describe('buildCorsOptions', () => {
  it('allows only the given origins, with credentials', () => {
    expect(buildCorsOptions(['http://localhost:3000'])).toEqual({
      origin: ['http://localhost:3000'],
      credentials: true,
    });
  });
});
