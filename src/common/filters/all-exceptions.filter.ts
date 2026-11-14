import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

/**
 * HTTP exceptions are returned unchanged. Anything else becomes a generic 500.
 *
 * Unexpected errors are logged without their message: Prisma messages embed
 * the query arguments (password hashes, emails, phone numbers), so only the
 * error name, its code and the stack frames are written to the logs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const response = host.switchToHttp().getResponse<unknown>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      httpAdapter.reply(
        response,
        typeof body === 'string' ? { statusCode: status, message: body } : body,
        status,
      );
      return;
    }

    this.logger.error(describe(exception), framesOf(exception));
    httpAdapter.reply(
      response,
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

function describe(exception: unknown): string {
  if (!(exception instanceof Error)) return 'Unhandled non-error exception';
  const code = (exception as { code?: unknown }).code;
  return `Unhandled ${exception.name}${typeof code === 'string' ? ` (${code})` : ''}`;
}

/** The stack without its first lines, which repeat the (unsafe) message. */
function framesOf(exception: unknown): string | undefined {
  if (!(exception instanceof Error) || !exception.stack) return undefined;
  const firstFrame = exception.stack.search(/\n\s+at /);
  return firstFrame === -1 ? undefined : exception.stack.slice(firstFrame + 1);
}
