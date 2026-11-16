import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { errorSummary } from '../utils/error-summary.js';

/** Body of every error response. `code` is stable: never change one. */
export interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  /** Validation errors, one readable message per invalid field. */
  errors?: string[];
  /** Per-dependency status of a failed health check. */
  details?: Record<string, unknown>;
}

export const VALIDATION_FAILED_CODE = 'VALIDATION_FAILED';
export const HEALTH_CHECK_FAILED_CODE = 'HEALTH_CHECK_FAILED';
export const INTERNAL_SERVER_ERROR_CODE = 'INTERNAL_SERVER_ERROR';

/**
 * Turns every error into `{ statusCode, code, message }`.
 *
 * - HTTP exceptions thrown with a `code` keep it; others get one derived from
 *   the status (`NOT_FOUND`, `TOO_MANY_REQUESTS`...), and ValidationPipe
 *   errors get `VALIDATION_FAILED` with the field messages in `errors`.
 * - Anything else becomes a generic 500.
 *
 * Errors are logged here, once: 5xx as `error`, 4xx without an explicit code
 * (unknown route, invalid body...) as `warn`; 4xx with a business code are
 * expected outcomes and not logged. Messages of unexpected errors are never
 * logged nor returned: Prisma messages embed query arguments (password
 * hashes, emails, phone numbers).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ method?: string; url?: string }>();
    const route = { method: request?.method, url: request?.url };

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        {
          err: { ...errorSummary(exception), stack: framesOf(exception) },
          ...route,
        },
        'Unhandled exception',
      );
      httpAdapter.reply(
        ctx.getResponse(),
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: INTERNAL_SERVER_ERROR_CODE,
          message: 'Internal server error',
        } satisfies ErrorResponse,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      return;
    }

    const status = exception.getStatus();
    const { body, explicitCode } = toErrorResponse(exception, status);
    if (status >= 500) {
      this.logger.error(
        { statusCode: status, code: body.code, ...route },
        'Request failed',
      );
    } else if (!explicitCode) {
      this.logger.warn(
        { statusCode: status, code: body.code, ...route },
        'Request rejected',
      );
    }
    httpAdapter.reply(ctx.getResponse(), body, status);
  }
}

function toErrorResponse(
  exception: HttpException,
  status: number,
): { body: ErrorResponse; explicitCode: boolean } {
  const raw = exception.getResponse();
  const fields: Record<string, unknown> =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  if (typeof fields.code === 'string') {
    return {
      explicitCode: true,
      body: {
        statusCode: status,
        code: fields.code,
        message:
          typeof fields.message === 'string'
            ? fields.message
            : exception.message,
      },
    };
  }

  // ValidationPipe: `message` is the list of constraint messages.
  if (Array.isArray(fields.message)) {
    return {
      explicitCode: false,
      body: {
        statusCode: status,
        code: VALIDATION_FAILED_CODE,
        message: 'Request validation failed',
        errors: fields.message.map(String),
      },
    };
  }

  // Terminus: the health check result, already free of internal details.
  if (fields.status === 'error' && typeof fields.details === 'object') {
    return {
      explicitCode: true,
      body: {
        statusCode: status,
        code: HEALTH_CHECK_FAILED_CODE,
        message: 'Health check failed',
        details: fields.details as Record<string, unknown>,
      },
    };
  }

  return {
    explicitCode: false,
    body: {
      statusCode: status,
      code: codeForStatus(status),
      message:
        typeof raw === 'string'
          ? raw
          : typeof fields.message === 'string'
            ? fields.message
            : exception.message,
    },
  };
}

/** `404` -> `NOT_FOUND`, from Nest's HttpStatus enum. */
function codeForStatus(status: number): string {
  const name = (HttpStatus as unknown as Record<number, string | undefined>)[
    status
  ];
  return name ?? (status >= 500 ? INTERNAL_SERVER_ERROR_CODE : 'HTTP_ERROR');
}

/** The stack without its first lines, which repeat the (unsafe) message. */
function framesOf(exception: unknown): string | undefined {
  if (!(exception instanceof Error) || !exception.stack) return undefined;
  const firstFrame = exception.stack.search(/\n\s+at /);
  return firstFrame === -1 ? undefined : exception.stack.slice(firstFrame + 1);
}
