import { Worker } from "bullmq";
import { IMAGE_QUEUE_NAME, getRedisConnection, type ImageJobData, type ImageJobResult } from "@/lib/image-jobs";
import { processImageJob } from "@/lib/image-processor";

const concurrency = Number.parseInt(process.env.IMAGE_WORKER_CONCURRENCY || "5", 10);

const worker = new Worker<ImageJobData, ImageJobResult>(
  IMAGE_QUEUE_NAME,
  async (job) => {
    console.log(`[ImageWorker] Processing job ${job.id} for user ${job.data.userId}`);
    const result = await processImageJob(job.data);
    console.log(`[ImageWorker] Completed job ${job.id}`);
    return result;
  },
  {
    connection: getRedisConnection(),
    concurrency: Number.isFinite(concurrency) ? concurrency : 5,
    lockDuration: 240000,
  }
);

worker.on("failed", (job, error) => {
  console.error(`[ImageWorker] Job ${job?.id || "unknown"} failed:`, error);
});

worker.on("error", (error) => {
  console.error("[ImageWorker] Worker error:", error);
});

async function shutdown() {
  console.log("[ImageWorker] Shutting down...");
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[ImageWorker] Started ${IMAGE_QUEUE_NAME} with concurrency ${worker.opts.concurrency}`);
