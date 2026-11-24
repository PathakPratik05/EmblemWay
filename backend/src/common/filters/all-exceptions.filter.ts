import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError, ErrorCode } from '../errors/app-error';
import { getRequestId } from '../middleware/request-id.middleware';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

/**
 * Converts every thrown value into a consistent JSON envelope. Internal details
 * (stack traces, SQL) are logged server-side and never returned to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = getRequestId(req);
    const { status, code, message, details } = this.map(exception);

    if (status >= 500) {
      this.logger.error(
        {
          err:
            exception instanceof Error
              ? { name: exception.name, message: exception.message, stack: exception.stack }
              : exception,
          requestId,
          path: req.path,
        },
        'Unhandled error',
      );
    }
    if (
      status === 429 &&
      details &&
      typeof details === 'object' &&
      'retryAfterSeconds' in details
    ) {
      res.setHeader(
        'Retry-After',
        String((details as { retryAfterSeconds: number }).retryAfterSeconds),
      );
    }
    const body: ErrorBody = {
      error: { code, message, requestId, ...(details !== undefined ? { details } : {}) },
    };
    res.status(status).json(body);
  }

  private map(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof ThrottlerException) {
      return {
        status: 429,
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many requests. Please slow down.',
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (
        status === 400 &&
        typeof response === 'object' &&
        response !== null &&
        'message' in response
      ) {
        const msg = response.message;
        return {
          status,
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Request validation failed',
          details: Array.isArray(msg) ? { fields: msg } : { reason: msg },
        };
      }
      const code =
        status === 401
          ? ErrorCode.UNAUTHENTICATED
          : status === 403
            ? ErrorCode.FORBIDDEN
            : status === 404
              ? ErrorCode.NOT_FOUND
              : status === 413
                ? ErrorCode.UPLOAD_INVALID
                : status === 429
                  ? ErrorCode.RATE_LIMITED
                  : status >= 500
                    ? ErrorCode.INTERNAL_ERROR
                    : ErrorCode.VALIDATION_FAILED;
      return { status, code, message: exception.message };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: 409,
            code: ErrorCode.CONFLICT,
            message: 'A record with these details already exists',
          };
        case 'P2025':
          return { status: 404, code: ErrorCode.NOT_FOUND, message: 'Record not found' };
        case 'P2003':
          return {
            status: 400,
            code: ErrorCode.VALIDATION_FAILED,
            message: 'Referenced record does not exist',
          };
        case 'P2034':
          return {
            status: 409,
            code: ErrorCode.CONFLICT,
            message: 'Concurrent update detected, please retry',
          };
        case 'P1001':
        case 'P1002':
        case 'P1017':
          return {
            status: 503,
            code: ErrorCode.DATABASE_UNAVAILABLE,
            message: 'Database temporarily unavailable',
          };
        default:
          return {
            status: 500,
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Unexpected database error',
          };
      }
    }
    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      return {
        status: 503,
        code: ErrorCode.DATABASE_UNAVAILABLE,
        message: 'Database temporarily unavailable',
      };
    }
    return { status: 500, code: ErrorCode.INTERNAL_ERROR, message: 'An unexpected error occurred' };
  }
}
