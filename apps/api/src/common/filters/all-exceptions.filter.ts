import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  message: string;
  error: string;
  requestId?: string;
  timestamp: string;
  path: string;
}

/**
 * Guarantees no raw database error, stack trace, or internal detail is ever
 * serialized to a client. Full detail is logged server-side with the request ID for
 * correlation. See SECURITY.md § API & Input Security.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId =
      (request.headers['x-request-id'] as string | undefined) ?? undefined;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const typed = body as { message?: string | string[]; error?: string };
        message = Array.isArray(typed.message)
          ? typed.message.join(', ')
          : (typed.message ?? exception.message);
        error = typed.error ?? error;
      }
      if (statusCode < HttpStatus.INTERNAL_SERVER_ERROR) {
        error = HttpStatus[statusCode] ?? error;
      }
    } else if (this.isKnownClientError(exception)) {
      // Middleware-level errors (body-parser/raw-body — e.g. a 413 when a
      // request body exceeds the configured JSON size limit, or a 400 for
      // malformed JSON) are never NestJS HttpExceptions, but carry a
      // legitimate `status`/`statusCode` via the `http-errors` package
      // convention every Express middleware uses. Found via this phase's own
      // load/limits testing: without this branch, a plain oversized-upload
      // attempt fell through to a raw, unhelpful 500 instead of the correct
      // 413 — a real bug, not a hypothetical one. Scoped to 4xx only: a
      // non-HttpException claiming a 5xx status is not trusted the same way,
      // since that's exactly the "might leak internal detail" case this
      // filter exists to prevent.
      statusCode = this.clientErrorStatus(exception);
      message = exception instanceof Error ? exception.message : 'Bad request';
      error = HttpStatus[statusCode] ?? 'Bad Request';
    } else {
      // Never leak the real exception message/stack for non-HTTP (e.g. database,
      // unexpected runtime) errors — log full detail internally instead.
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (
      exception instanceof HttpException &&
      statusCode >= HttpStatus.INTERNAL_SERVER_ERROR
    ) {
      this.logger.error(
        `Server error on ${request.method} ${request.url}: ${message}`,
        exception.stack,
      );
    }

    const body: ErrorResponseBody = {
      statusCode,
      message,
      error,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }

  private clientErrorStatus(exception: unknown): number {
    const candidate = exception as { status?: unknown; statusCode?: unknown };
    const value =
      typeof candidate.status === 'number'
        ? candidate.status
        : candidate.statusCode;
    return typeof value === 'number' ? value : HttpStatus.BAD_REQUEST;
  }

  private isKnownClientError(exception: unknown): boolean {
    if (!(exception instanceof Error)) {
      return false;
    }
    const status = this.clientErrorStatus(exception);
    return status >= 400 && status < 500;
  }
}
