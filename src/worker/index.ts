import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { closePool } from '../db/pool';
import { claimJob, recoverStaleJobs, recoverStaleOutgoingMessages, workerHeartbeat } from '../db/repository';
import { processIncomingJob } from '../services/botProcessor';
import { processMediaJob } from '../services/mediaStorage';

const workerId = process.env.WORKER_ID ?? `worker-${randomUUID()}`;
const pollMs = Number(process.env.WORKER_POLL_MS ?? '250');
const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? '16'));
let stopped = false;

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runLane() {
  while (!stopped) {
    try {
      const job = await claimJob(workerId);
      if (!job) {
        await pause(pollMs);
        continue;
      }
      if (job.type === 'download_media') await processMediaJob(job);
      else await processIncomingJob(job);
    } catch (error) {
      console.error('[worker] Error del carril:', error);
      await pause(pollMs);
    }
  }
}

async function maintenanceLoop() {
  let lastOutboundRecoveryAt = 0;
  while (!stopped) {
    try {
      await workerHeartbeat(workerId);
      await recoverStaleJobs();
      if (Date.now() - lastOutboundRecoveryAt >= 60_000) {
        lastOutboundRecoveryAt = Date.now();
        await recoverStaleOutgoingMessages();
      }
    } catch (error) { console.error('[worker] Error del ciclo:', error); }
    await pause(5_000);
  }
}
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
console.log(`[worker] Iniciado ${workerId} (concurrencia ${concurrency})`);
void (async () => {
  await Promise.all([recoverStaleJobs(), recoverStaleOutgoingMessages()]);
  await Promise.all([maintenanceLoop(), ...Array.from({ length: concurrency }, () => runLane())]);
  await closePool();
})().catch(error => {
  console.error('[worker] Finalización inesperada:', error);
  process.exitCode = 1;
});
