/**
 * The error type and code, without the message: Prisma and driver messages
 * can embed query arguments or connection details. Use it to log errors whose
 * message may hold personal data or secrets.
 */
export function errorSummary(err: unknown): { type: string; code?: string } {
  if (!(err instanceof Error)) return { type: typeof err };
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number'
    ? { type: err.name, code: String(code) }
    : { type: err.name };
}
