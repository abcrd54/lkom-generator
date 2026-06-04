"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ImageGenerateRequest, ImageQuota, ChatMessage } from "@/types";
import { toast } from "sonner";

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

      // Save message with image
      const { data: savedMsg } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: `Gambar: ${options.prompt}`,
          model: "cx/gpt-5.5-image",
          image_url: data.imageUrl,
        })
        .select()
        .single();

      // Update quota
      await fetchQuota();

      if (savedMsg) {
        return {
          id: savedMsg.id,
          role: "assistant",
          content: `Gambar: ${options.prompt}`,
          model: "cx/gpt-5.5-image",
          imageUrl: data.imageUrl,
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
