"use client";

import { useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, ReferenceImage } from "@/types";

type MessageRow = {
  id: string;
  role: string;
  content: string | null;
  model: string | null;
  image_url?: string | null;
  reference_images?:
    | ReferenceImage[]
    | null;
  created_at: string;
  images?: {
    r2_url: string | null;
    expires_at: string;
    storage_deleted_at?: string | null;
  }[] | null;
};

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const loadRequestRef = useRef(0);
  const [supabase] = useState(() => createClient());

  const loadMessages = useCallback(async (conversationId: string) => {
    const requestId = ++loadRequestRef.current;
    setLoadingMessages(true);
    try {
      const { data } = await supabase
        .from("messages")
        .select("id, role, content, model, image_url, reference_images, created_at, images(r2_url, expires_at, storage_deleted_at)")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (data && requestId === loadRequestRef.current) {
        const formatted: ChatMessage[] = (data as MessageRow[]).map((m) => {
          const image = Array.isArray(m.images) ? m.images[0] : undefined;
          const imageUrl = image?.r2_url || undefined;
          const imageExpired = Boolean(
            image && (!image.r2_url || image.storage_deleted_at || new Date(image.expires_at).getTime() <= Date.now())
          );

          return {
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content || "",
            model: m.model || undefined,
            imageUrl: imageUrl || m.image_url || undefined,
            imageExpired,
            imageExpiresAt: image?.expires_at,
            referenceImages: Array.isArray(m.reference_images) ? m.reference_images : undefined,
            createdAt: m.created_at,
          };
        });
        setMessages(formatted);
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoadingMessages(false);
      }
    }
  }, [supabase]);

  const sendMessage = useCallback(async (content: string, conversationId: string) => {
    setLoading(true);
    setStreamingContent("");

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const { error: insertError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "user",
        content,
      });

      if (insertError) {
        throw insertError;
      }

      const { data: conv } = await supabase
        .from("conversations")
        .select("title")
        .eq("id", conversationId)
        .single();

      if (conv?.title === "Chat Baru") {
        const title = content.length > 50 ? content.slice(0, 50) + "..." : content;
        await supabase
          .from("conversations")
          .update({ title })
          .eq("id", conversationId);
      }

      abortRef.current = new AbortController();

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: content }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      if (reader) {
        let buffer = "";

        const processLine = (line: string) => {
          if (!line.startsWith("data: ")) return;

          const data = line.slice(6);
          if (data === "[DONE]") return;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              setStreamingContent(fullContent);
            }
          } catch {
            // Skip invalid JSON
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const line of lines) {
            processLine(line);
          }
        }

        buffer += decoder.decode();
        if (buffer) {
          for (const line of buffer.split(/\r?\n/)) {
            processLine(line);
          }
        }
      }

      setStreamingContent("");

      // Save assistant message
      if (fullContent) {
        const { data: savedMsg } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: fullContent,
            model: "cx/gpt-5.5",
          })
          .select()
          .single();

        if (savedMsg) {
          // Add final message BEFORE clearing streaming
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== userMsg.id),
            { ...userMsg, id: `user-${Date.now()}` },
            {
              id: savedMsg.id,
              role: "assistant",
              content: fullContent,
              model: "cx/gpt-5.5",
              createdAt: savedMsg.created_at,
            },
          ]);
        }
      }
      // Clear streaming after message is added
      setStreamingContent("");
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") return;
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "Maaf, terjadi kesalahan. Silakan coba lagi.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setStreamingContent("");
  }, []);

  return { messages, loading, loadingMessages, streamingContent, loadMessages, sendMessage, stopStreaming, setMessages };
}
