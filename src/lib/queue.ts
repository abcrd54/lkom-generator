type QueueTask<T> = () => Promise<T>;

class RequestQueue {
  private queue: Array<{
    task: QueueTask<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];

  private running = 0;
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;

  constructor(maxConcurrent = 10, maxQueueSize = 100) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
  }

  async add<T>(task: QueueTask<T>, timeout = 180000): Promise<T> {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error("Queue penuh, coba lagi nanti");
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const idx = this.queue.findIndex((item) => item.resolve === resolve);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new Error("Request timeout"));
        }
      }, timeout);

      this.queue.push({
        task: async () => {
          try {
            const result = await task();
            clearTimeout(timeoutId);
            return result;
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.processNext();
    });
  }

  private async processNext() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const item = this.queue.shift();

    if (!item) {
      this.running--;
      return;
    }

    try {
      const result = await item.task();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.running--;
      this.processNext();
    }
  }

  get stats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
    };
  }
}

export const chatQueue = new RequestQueue(20, 200);
export const imageQueue = new RequestQueue(3, 30);  // 3 concurrent, max 30 queued
