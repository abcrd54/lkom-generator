"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Sidebar, MobileSidebar } from "@/components/chat/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { ChatInput } from "@/components/chat/chat-input";
import { useChat } from "@/hooks/use-chat";
import { useImageGen } from "@/hooks/use-image-gen";
import { useConversations } from "@/hooks/use-conversations";
import type { ImageGenerateRequest } from "@/types";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export default function ChatIdPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params?.id as string;
  const [conversationReady, setConversationReady] = useState(false);
  const [pendingImageJob, setPendingImageJob] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const {
    messages,
    loading: chatLoading,
    loadingMessages,
    streamingContent,
    loadMessages,
    sendMessage,
    setMessages,
  } = useChat();
  const { loading: imageLoading, quota, generateImage, fetchQuota } = useImageGen();
  const { createConversation, refreshTrigger, refresh } = useConversations();

  const currentConversationId = conversationId || null;

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback((jobId: string, convId: string) => {
    stopPolling();
    setPendingImageJob(true);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/images/status/${jobId}`);
        const data = await res.json();

        if (data.status === "completed") {
          stopPolling();
          setPendingImageJob(false);
          await loadMessages(convId);
          await fetchQuota();
          refresh();
        } else if (data.status === "failed") {
          stopPolling();
          setPendingImageJob(false);

          await new Promise((r) => setTimeout(r, 1500));
          await loadMessages(convId);

          const supabase = createClient();
          const { data: recentMsgs } = await supabase
            .from("messages")
            .select("id, model")
            .eq("conversation_id", convId)
            .eq("role", "assistant")
            .order("created_at", { ascending: false })
            .limit(1);

          if (!recentMsgs?.length || recentMsgs[0].model !== "error") {
            await supabase.from("messages").insert({
              conversation_id: convId,
              role: "assistant",
              content: "Maaf, gambar gagal dibuat. Silakan coba lagi nanti.",
              model: "error",
            });
            await loadMessages(convId);
          }

          refresh();
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
  }, [stopPolling, loadMessages, fetchQuota, refresh]);

  useEffect(() => {
    const validateConversation = async () => {
      if (!conversationId) {
        setConversationReady(false);
        return;
      }

      setConversationReady(false);

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!data) {
        setMessages([]);
        toast.error("Percakapan tidak ditemukan");
        router.replace("/chat");
        return;
      }

      setConversationReady(true);

      try {
        const activeRes = await fetch(`/api/images/active/${conversationId}`);
        const activeData = await activeRes.json();
        if (activeData.hasPendingJob && activeData.jobId) {
          setPendingImageJob(true);
          startPolling(activeData.jobId, conversationId);
        }
      } catch {
        // ignore
      }

      await loadMessages(conversationId);
    };

    validateConversation();
    fetchQuota();

    return () => stopPolling();
  }, [conversationId, fetchQuota, loadMessages, router, setMessages, startPolling, stopPolling]);

  useEffect(() => {
    if (!conversationId || !conversationReady || !pendingImageJob) return;

    const interval = setInterval(async () => {
      await loadMessages(conversationId);
    }, 5000);

    return () => clearInterval(interval);
  }, [conversationId, conversationReady, pendingImageJob, loadMessages]);

  const handleNewChat = useCallback(async () => {
    stopPolling();
    setPendingImageJob(false);
    setConversationReady(false);
    setMessages([]);
    router.push("/chat");
  }, [router, setMessages, stopPolling]);

  const handleSelectConversation = useCallback((id: string) => {
    if (id === conversationId) {
      return;
    }
    stopPolling();
    setPendingImageJob(false);
    setConversationReady(false);
    setMessages([]);
    router.push(`/chat/${id}`);
  }, [conversationId, router, setMessages, stopPolling]);

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (currentConversationId && conversationReady) return currentConversationId;
    const newId = await createConversation();
    if (newId) {
      refresh();
      router.push(`/chat/${newId}`);
    }
    return newId;
  }, [conversationReady, currentConversationId, createConversation, refresh, router]);

  const handleSendMessage = useCallback(async (content: string) => {
    const convId = await ensureConversation();
    if (!convId) {
      toast.error("Gagal membuat percakapan");
      return;
    }
    await sendMessage(content, convId);
    refresh();
  }, [ensureConversation, sendMessage, refresh]);

  const handleGenerateImage = useCallback(async (options: ImageGenerateRequest) => {
    const convId = await ensureConversation();
    if (!convId) {
      toast.error("Gagal membuat percakapan");
      return;
    }

    const persistedReferenceImages = options.referenceImages?.length
      ? options.referenceImages.map(({ name, mimeType, url }) => ({ name, mimeType, url }))
      : null;

    const supabase = createClient();
    await supabase.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: options.prompt.trim(),
      reference_images: persistedReferenceImages,
    });

    setMessages((prev) => [
      ...prev,
      {
        id: `user-img-${Date.now()}`,
        role: "user",
        content: options.prompt.trim(),
        referenceImages: options.referenceImages,
        createdAt: new Date().toISOString(),
      },
    ]);

    const result = await generateImage(options, convId);
    if (result) {
      setMessages((prev) => [...prev, result]);
      refresh();
    }
  }, [ensureConversation, generateImage, setMessages, refresh]);

  const actionLoading = chatLoading || imageLoading;
  const historyLoading = loadingMessages || (!!conversationId && !conversationReady);
  const chatAreaLoading = actionLoading || pendingImageJob;

  return (
    <div className="flex h-screen bg-slate-50/50">
      <div className="hidden md:block">
        <Sidebar
          currentConversationId={currentConversationId}
          onSelectConversation={handleSelectConversation}
          onNewChat={handleNewChat}
          refreshTrigger={refreshTrigger}
        />
      </div>

      <div className="md:hidden">
        <MobileSidebar>
          <Sidebar
            currentConversationId={currentConversationId}
            onSelectConversation={handleSelectConversation}
            onNewChat={handleNewChat}
            refreshTrigger={refreshTrigger}
          />
        </MobileSidebar>
      </div>

      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
          <div className="flex items-center gap-2">
            <div className="md:hidden w-10" />
            <h1 className="text-sm font-medium text-slate-900 truncate">
              Percakapan
            </h1>
          </div>
          {quota && (
            <div className="text-xs text-muted-foreground">
              Sisa kuota gambar: <span className={quota.remaining <= 3 ? "text-red-500 font-medium" : "text-blue-600 font-medium"}>{quota.remaining}/{quota.limit}</span>
            </div>
          )}
        </div>

        <ChatArea
          messages={messages}
          loading={chatAreaLoading}
          loadingMessages={historyLoading}
          streamingContent={streamingContent}
          pendingText={pendingImageJob ? "Gambar sedang dibuat..." : imageLoading ? "Gambar masuk antrean" : "AI sedang menyusun jawaban"}
        />

        <ChatInput
          onSendMessage={handleSendMessage}
          onGenerateImage={handleGenerateImage}
          loading={actionLoading}
          imageQuota={quota}
          disabled={!conversationReady}
        />
      </div>
    </div>
  );
}
