// ─── Response shape helpers ───────────────────────────────────────────────────

export interface SuccessResponse<T> {
  success: true
  data: T
}

export interface ErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export interface PaginatedResponse<T> {
  success: true
  data: T[]
  total: number
  page: number
}

export function success<T>(data: T): SuccessResponse<T> {
  return { success: true, data }
}

export function errorResponse(code: string, message: string, details?: unknown): ErrorResponse {
  return {
    success: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  }
}

export function paginated<T>(data: T[], total: number, page: number): PaginatedResponse<T> {
  return { success: true, data, total, page }
}

// ─── Custom application error ─────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code: string
  public readonly statusCode: number

  constructor(code: string, message: string, statusCode: number) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    // Restore prototype chain (required when extending built-ins in TS)
    Object.setPrototypeOf(this, AppError.prototype)
  }
}
