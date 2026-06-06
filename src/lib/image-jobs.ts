import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import type { AgeGroup, AspectRatio, DetailLevel, ImageLanguage, ImageStyle, ReferenceImage } from "@/types";

export const IMAGE_QUEUE_NAME = "lkom-image-generation";

export interface ImageJobData {
  userId: string;
  conversationId: string;
  originalPrompt: string;
  finalPrompt: string;
  style: ImageStyle;
  ageGroup: AgeGroup;
  aspectRatio: AspectRatio;
  detailLevel: DetailLevel;
  colorTheme: string;
  language: ImageLanguage;
  watermark?: string;
  referenceImage?: ReferenceImage;
  referenceImageUrl?: string;
  referenceImages?: ReferenceImage[];
  referenceImageUrls?: string[];
}

export interface ImageJobResult {
  imageUrl: string;
  imageId: string;
  messageId: string;
  model: string;
  prompt: string;
  metadata: {
    style: ImageStyle;
    ageGroup: AgeGroup;
    aspectRatio: AspectRatio;
    detailLevel: DetailLevel;
    colorTheme: string;
    language: ImageLanguage;
    watermark?: string;
  };
}

const defaultJobOptions: JobsOptions = {
  attempts: 2,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  removeOnComplete: {
    age: 60 * 60 * 24,
    count: 1000,
  },
  removeOnFail: {
    age: 60 * 60 * 24 * 7,
    count: 1000,
  },
};

type RedisConnectionOptions = QueueOptions["connection"];

let connection: RedisConnectionOptions | null = null;
let queue: Queue<ImageJobData, ImageJobResult, "generate"> | null = null;

export function getRedisConnection() {
  if (!connection) {
    const redisUrl = new URL(process.env.REDIS_URL || "redis://localhost:6379");
    connection = {
      host: redisUrl.hostname,
      port: Number.parseInt(redisUrl.port || "6379", 10),
      username: redisUrl.username || undefined,
      password: redisUrl.password || undefined,
      db: redisUrl.pathname ? Number.parseInt(redisUrl.pathname.slice(1) || "0", 10) : 0,
      tls: redisUrl.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }

  return connection;
}

export function getImageQueue() {
  if (!queue) {
    queue = new Queue<ImageJobData, ImageJobResult, "generate">(IMAGE_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions,
    });
  }

  return queue;
}
