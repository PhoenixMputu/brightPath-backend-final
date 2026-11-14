import { OTP_TTL_SECONDS } from './otp.service.js';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Subject and bodies of the email that carries the registration code. */
export function verificationEmail(
  firstName: string,
  code: string,
): { subject: string; html: string; text: string } {
  const minutes = OTP_TTL_SECONDS / 60;
  const name = escapeHtml(firstName);
  return {
    subject: `Your BrightPath verification code: ${code}`,
    text: [
      `Hello ${firstName},`,
      '',
      `Your BrightPath verification code is ${code}.`,
      `It expires in ${minutes} minutes.`,
      '',
      'If you did not create a BrightPath account, you can ignore this email.',
    ].join('\n'),
    html: `<!doctype html>
<html>
  <body style="font-family: Arial, sans-serif; color: #1f2937;">
    <p>Hello ${name},</p>
    <p>Your BrightPath verification code is:</p>
    <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">${code}</p>
    <p>It expires in ${minutes} minutes.</p>
    <p style="color: #6b7280;">If you did not create a BrightPath account, you can ignore this email.</p>
  </body>
</html>`,
  };
}
