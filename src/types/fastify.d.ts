import 'fastify'

/**
 * Augment @fastify/passport's PassportUser so that request.user carries
 * { id, email } for both OAuth and JWT-authenticated routes.
 */
declare module 'fastify' {
  interface PassportUser {
    id: string
    email: string
  }
}
