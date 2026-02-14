import { createLogger } from '@avaast/shared';

const logger = createLogger('auth');

export interface AuthContext {
  /** The DID of the authenticated user, if present */
  did?: string;
  /** Whether the request has valid authentication */
  authenticated: boolean;
}

/**
 * Extract auth context from a request.
 * Checks the Authorization header for "Bearer <token>" and decodes the JWT
 * payload to extract the DID (from `iss` or `sub` claims).
 *
 * This is a minimal implementation - it decodes without full signature
 * verification. In production, the JWT would be verified against PDS signing keys.
 */
export function extractAuth(req: Request): AuthContext {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { authenticated: false };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    logger.debug('Invalid Authorization header format');
    return { authenticated: false };
  }

  const token = parts[1];
  try {
    const payload = decodeJwtPayload(token);
    const did = payload.iss ?? payload.sub;
    if (typeof did === 'string' && did.startsWith('did:')) {
      return { did, authenticated: true };
    }

    logger.debug('JWT payload does not contain a valid DID', { payload });
    return { authenticated: false };
  } catch (err) {
    logger.debug('Failed to decode JWT', { error: err });
    return { authenticated: false };
  }
}

/**
 * Decode the payload segment of a JWT without verifying the signature.
 * JWTs have three base64url-encoded segments separated by dots: header.payload.signature
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new Error('Invalid JWT: expected 3 segments');
  }

  const payloadB64 = segments[1];
  const payloadJson = base64UrlDecode(payloadB64);
  return JSON.parse(payloadJson) as Record<string, unknown>;
}

/**
 * Decode a base64url-encoded string to a UTF-8 string.
 * base64url differs from base64 in that it uses - instead of + and _ instead of /,
 * and omits padding =.
 */
function base64UrlDecode(input: string): string {
  // Replace base64url characters with standard base64 characters
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if needed
  const padding = base64.length % 4;
  if (padding === 2) {
    base64 += '==';
  } else if (padding === 3) {
    base64 += '=';
  }

  // Decode from base64 to Buffer then to string
  const buffer = Buffer.from(base64, 'base64');
  return buffer.toString('utf-8');
}
