import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { closePool } from '../db/pool';
import { claimJob, recoverStaleJobs, recoverStaleOutgoingMessages, workerHeartbeat } from '../db/repository';
import { processIncomingJob } from '../services/botProcessor';
import { processMediaJob } from '../services/mediaStorage';

const workerId = process.env.WORKER_ID ?? `worker-${randomUUID()}`;
const pollMs = Number(process.env.WORKER_POLL_MS ?? '250');
const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? '6'));
let stopped = false;
let lastOutboundRecoveryAt = 0;

async function tick() {
  if (stopped) return;
  if (Date.now() - lastOutboundRecoveryAt >= 60_000) {
    lastOutboundRecoveryAt = Date.now();
    await recoverStaleOutgoingMessages();
  }
  const jobs = await Promise.all(Array.from({ length: concurrency }, () => claimJob(workerId)));
  await Promise.all(jobs.filter((job): job is NonNullable<typeof job> => Boolean(job)).map(job => job.type === 'download_media' ? processMediaJob(job) : processIncomingJob(job)));
}

async function loop() {
  while (!stopped) {
    try {
      await workerHeartbeat(workerId);
      await tick();
    } catch (error) { console.error('[worker] Error del ciclo:', error); }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
process.on('SIGTERM', async () => { stopped = true; await closePool(); });
process.on('SIGINT', async () => { stopped = true; await closePool(); });
console.log(`[worker] Iniciado ${workerId} (concurrencia ${concurrency})`);
void Promise.all([recoverStaleJobs(), recoverStaleOutgoingMessages()]).then(loop);
