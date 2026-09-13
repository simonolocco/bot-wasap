import assert from 'node:assert/strict';
import { AiProviderError, createOpenRouterClient } from '../src/ai/openRouter';

const success = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { total_tokens: 7 }, model: 'fixture' }));
async function main() {
  let calls = 0;
  const client = createOpenRouterClient({ key: 'fixture', model: 'fixture', fetcher: (async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.reasoning, undefined, 'optional reasoning must not exclude compatible providers');
    return calls === 1 ? new Response('', { status: 503 }) : success();
  }) as typeof fetch });
  assert.equal((await client([])).tokens, 7);
  assert.equal(calls, 2);
  for (const [status, code] of [[401, 'credentials'], [402, 'credit'], [429, 'rate_limit']] as const) {
    let attempts = 0;
    await assert.rejects(createOpenRouterClient({ key: 'fixture', model: 'fixture', fetcher: (async () => {
      attempts++; return new Response('private provider details', { status });
    }) as typeof fetch })([]), (e: unknown) => e instanceof AiProviderError && e.code === code && !e.message.includes('private'));
    assert.equal(attempts, 1);
  }
  let networkCalls = 0;
  assert.equal((await createOpenRouterClient({ key: 'fixture', model: 'fixture', fetcher: (async () => {
    if (++networkCalls === 1) throw new TypeError('private connection details');
    return success();
  }) as typeof fetch })([])).model, 'fixture');
  assert.equal(networkCalls, 2);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(createOpenRouterClient({ key: 'fixture', model: 'fixture', timeoutMs: 500, fetcher: (async (_u, init) => {
      await new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)));
      return success();
    }) as typeof fetch })([], { timeoutMs: 10 }), (e: unknown) => e instanceof AiProviderError && e.code === 'timeout');
  } finally { clearTimeout(keepAlive); }
  for (const response of [new Response('not json'), new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }))]) {
    await assert.rejects(createOpenRouterClient({ key: 'fixture', model: 'fixture', fetcher: (async () => response) as typeof fetch })([]), /completa/);
  }
  console.log('PASS OpenRouter: transient retry, no quota retry, deadline, sanitized errors, complete JSON');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
