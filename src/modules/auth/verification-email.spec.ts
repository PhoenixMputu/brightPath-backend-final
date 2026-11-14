import { verificationEmail } from './verification-email.js';

describe('verificationEmail', () => {
  it('puts the code and its validity in both bodies', () => {
    const email = verificationEmail('Victory', '042137');

    expect(email.subject).toContain('042137');
    for (const body of [email.text, email.html]) {
      expect(body).toContain('042137');
      expect(body).toContain('10 minutes');
      expect(body).toContain('Victory');
    }
  });

  it('escapes the first name in the HTML body', () => {
    const { html } = verificationEmail('<img src=x onerror=alert(1)>', '1');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
