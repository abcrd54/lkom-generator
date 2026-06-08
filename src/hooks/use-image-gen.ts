"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ImageGenerateRequest, ImageQuota, ChatMessage } from "@/types";
import { toast } from "sonner";

const IMAGE_JOB_POLL_INTERVAL = 2000;
const IMAGE_JOB_TIMEOUT = 600000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useImageGen() {
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState<ImageQuota | null>(null);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      requestTokenRef.current += 1;
    };
  }, []);

  const fetchQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/images/quota");
      if (res.ok) {
        const data = await res.json();
        setQuota(data);
      }
    } catch {
      // ignore
    }
  }, []);

  const generateImage = useCallback(async (
    options: ImageGenerateRequest,
    conversationId: string
  ): Promise<ChatMessage | null> => {
    const requestToken = ++requestTokenRef.current;
    setLoading(true);
    const controller = new AbortController();

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...options, conversationId }),
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          toast.error(`Kuota gambar habis. Reset: ${new Date(data.resetAt).toLocaleString("id-ID")}`);
        } else {
          toast.error(data.error || "Gagal generate gambar");
        }
        return null;
      }

      if (!data.jobId) {
        toast.error("Job gambar tidak valid");
        return null;
      }

      toast.info("Gambar masuk antrean");

      const startedAt = Date.now();
      let result: { messageId: string; imageUrl: string; model?: string } | null = null;

      while (Date.now() - startedAt < IMAGE_JOB_TIMEOUT) {
        if (requestToken !== requestTokenRef.current) {
          controller.abort();
          return null;
        }

        await wait(IMAGE_JOB_POLL_INTERVAL);

        const statusRes = await fetch(`/api/images/status/${data.jobId}`, {
          signal: controller.signal,
        });
        const statusData = await statusRes.json();

        if (!statusRes.ok) {
          toast.error(statusData.error || "Gagal mengambil status gambar");
          return null;
        }

        if (statusData.status === "completed") {
          result = statusData.result;
          break;
        }

        if (statusData.status === "failed") {
          toast.error(statusData.error || "Gagal generate gambar");
          return null;
        }
      }

      if (!result) {
        toast.error("Generate gambar terlalu lama. Cek percakapan beberapa saat lagi.");
        return null;
      }

      // Update quota
      await fetchQuota();

      return {
        id: result.messageId,
        role: "assistant",
        content: "",
        model: result.model || "cx/gpt-5.5-image",
        imageUrl: result.imageUrl,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return null;
      }
      toast.error("Gagal generate gambar");
      return null;
    } finally {
      if (requestToken === requestTokenRef.current) {
        setLoading(false);
      }
    }
  }, [fetchQuota]);

  return { loading, quota, generateImage, fetchQuota };
}
