"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ImageGenerateRequest, ImageQuota, ChatMessage } from "@/types";
import { toast } from "sonner";

const IMAGE_JOB_POLL_INTERVAL = 2000;
const IMAGE_JOB_TIMEOUT = 240000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useImageGen() {
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState<ImageQuota | null>(null);
  const supabase = createClient();

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
    setLoading(true);

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...options, conversationId }),
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
      let result: { messageId: string; imageUrl: string } | null = null;

      while (Date.now() - startedAt < IMAGE_JOB_TIMEOUT) {
        await wait(IMAGE_JOB_POLL_INTERVAL);

        const statusRes = await fetch(`/api/images/status/${data.jobId}`);
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

      const { data: savedMsg } = await supabase
        .from("messages")
        .select("*")
        .eq("id", result.messageId)
        .eq("conversation_id", conversationId)
        .single();

      // Update quota
      await fetchQuota();

      if (savedMsg) {
        return {
          id: savedMsg.id,
          role: "assistant",
          content: `Gambar: ${options.prompt}`,
          model: "cx/gpt-5.5-image",
          imageUrl: savedMsg.image_url || result.imageUrl,
          createdAt: savedMsg.created_at,
        };
      }

      return null;
    } catch {
      toast.error("Gagal generate gambar");
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabase, fetchQuota]);

  return { loading, quota, generateImage, fetchQuota };
}
