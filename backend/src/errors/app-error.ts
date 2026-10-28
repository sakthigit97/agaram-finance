export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function badRequest(message: string, code = 'VALIDATION_ERROR') {
  return new AppError(400, code, message)
}

export function unauthorized() {
  return new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
}

export function forbidden() {
  return new AppError(403, 'FORBIDDEN', 'You are not allowed to perform this action.')
}

export function notFound(message = 'The requested record was not found.') {
  return new AppError(404, 'NOT_FOUND', message)
}

export function conflict(message: string, code = 'CONFLICT') {
  return new AppError(409, code, message)
}
