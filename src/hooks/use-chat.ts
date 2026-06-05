"use client";

import { useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage } from "@/types";

type MessageRow = {
  id: string;
  role: string;
  content: string | null;
  model: string | null;
  image_url?: string | null;
  created_at: string;
  images?: { r2_url: string | null }[] | null;
};

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const supabase = createClient();

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("*, images(r2_url)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (data) {
      const formatted: ChatMessage[] = (data as MessageRow[]).map((m) => {
        const imageUrl = Array.isArray(m.images) ? m.images[0]?.r2_url : undefined;

        return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content || "",
        model: m.model || undefined,
        imageUrl: imageUrl || m.image_url || undefined,
        createdAt: m.created_at,
        };
      });
      setMessages(formatted);
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
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

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
            }
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

  return { messages, loading, streamingContent, loadMessages, sendMessage, stopStreaming, setMessages };
}
