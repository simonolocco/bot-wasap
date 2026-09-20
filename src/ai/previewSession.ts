import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(12000) })).max(12),
  token: z.string().uuid(), updated: z.number(), paused: z.boolean(), order: z.boolean(),
});
export type PreviewSession = z.infer<typeof schema>;
function key() {
  const secret = process.env.AI_PREVIEW_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Falta configurar la sesión de la prueba en el servidor.');
  return secret;
}
export function signSession(session: PreviewSession) {
  const data = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${data}.${createHmac('sha256', key()).update(data).digest('base64url')}`;
}
export function restoreSession(input: unknown): PreviewSession | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'string' || input.length > 200000) throw new Error('La conversación guardada no es válida. Iniciá una nueva conversación.');
  const [data, signature, extra] = input.split('.');
  const expected = createHmac('sha256', key()).update(data).digest('base64url');
  if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error('La conversación guardada no es válida. Iniciá una nueva conversación.');
  }
  const parsed = schema.parse(JSON.parse(Buffer.from(data, 'base64url').toString()));
  // Expiry is a normal fresh conversation, never a provider/advisor failure.
  return Date.now() - parsed.updated <= 86400000 ? parsed : undefined;
}
