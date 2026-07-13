import type { IncomingMessage } from 'http';

// Storage keys (`videos/{uuid}`) contain a slash, which would otherwise split
// the tus Location URL into two path segments. Encoding the id as a single
// base64url segment keeps the URL opaque and routable; getFileIdFromRequest
// reverses it so internal lookups see the real, slash-containing key again.
export function generateUploadUrl(
  _req: IncomingMessage,
  options: { proto: string; host: string; path: string; id: string },
): string {
  const encodedId = Buffer.from(options.id, 'utf-8').toString('base64url');
  return `${options.proto}://${options.host}${options.path}/${encodedId}`;
}

export function getUploadIdFromRequest(
  _req: IncomingMessage,
  lastPath?: string,
): string | undefined {
  if (!lastPath) return undefined;
  return Buffer.from(lastPath, 'base64url').toString('utf-8');
}
