"use client";

export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar, MobileSidebar } from "@/components/chat/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { ChatInput } from "@/components/chat/chat-input";
import { useChat } from "@/hooks/use-chat";
import { useImageGen } from "@/hooks/use-image-gen";
import { useConversations } from "@/hooks/use-conversations";
import type { ImageGenerateRequest } from "@/types";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { getChatImageUrl } from "@/lib/image-url";

function getLatestImageReference(messages: ReturnType<typeof useChat>["messages"]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.imageUrl || message.imageExpired) continue;

    return {
      name: "Gambar terakhir",
      mimeType: "image/png",
      url: message.imageUrl,
      previewUrl: getChatImageUrl(message.imageUrl),
    };
  }

  return null;
}

function getConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  return trimmed.length > 50 ? `${trimmed.slice(0, 50)}...` : trimmed;
}

export default function ChatPage() {
  const router = useRouter();

  const { messages, loading: chatLoading, streamingContent, sendMessage, setMessages } = useChat();
  const { loading: imageLoading, quota, enqueueImage, fetchQuota } = useImageGen();
  const { createConversation, refreshTrigger, refresh } = useConversations();

  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  useEffect(() => {
    const ensureUser = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
      }
    };
    ensureUser();
  }, [router]);

  const handleNewChat = useCallback(async () => {
    setCurrentConversationId(null);
    setMessages([]);
    router.push("/chat");
  }, [router, setMessages]);

  const handleSelectConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
    setMessages([]);
    router.push(`/chat/${id}`);
  }, [router, setMessages]);

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (currentConversationId) return currentConversationId;
    const newId = await createConversation();
    if (newId) {
      setCurrentConversationId(newId);
      refresh();
    }
    return newId;
  }, [currentConversationId, createConversation, refresh]);

  const handleSendMessage = useCallback(async (content: string) => {
    const shouldNavigate = !currentConversationId;
    const convId = await ensureConversation();
    if (!convId) {
      toast.error("Gagal membuat percakapan");
      return;
    }
    await sendMessage(content, convId);
    if (shouldNavigate) {
      router.replace(`/chat/${convId}`);
    }
    refresh();
  }, [currentConversationId, ensureConversation, sendMessage, refresh, router]);

  const handleGenerateImage = useCallback(async (options: ImageGenerateRequest) => {
    const shouldNavigate = !currentConversationId;
    const convId = await ensureConversation();
    if (!convId) {
      toast.error("Gagal membuat percakapan");
      return;
    }

    const persistedReferenceImages = options.referenceImages?.length
      ? options.referenceImages.map(({ name, mimeType, url }) => ({ name, mimeType, url }))
      : null;

    const supabase = createClient();
    const { error: insertError } = await supabase.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: options.prompt.trim(),
      reference_images: persistedReferenceImages,
    });

    if (insertError) {
      toast.error("Gagal menyimpan prompt gambar");
      return;
    }

    await supabase
      .from("conversations")
      .update({ title: getConversationTitle(options.prompt) })
      .eq("id", convId)
      .eq("title", "Chat Baru");

    refresh();

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

    const jobId = await enqueueImage(options, convId);
    if (!jobId) return;

    if (shouldNavigate) {
      router.replace(`/chat/${convId}`);
      refresh();
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `pending-${Date.now()}`,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        model: "cx/gpt-5.5-image",
      },
    ]);
    refresh();
  }, [currentConversationId, ensureConversation, enqueueImage, setMessages, refresh, router]);

  const loading = chatLoading || imageLoading;
  const latestImageReference = getLatestImageReference(messages);

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
              {currentConversationId ? "Percakapan" : "Chat Baru"}
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
          loading={loading}
          streamingContent={streamingContent}
          pendingText={imageLoading ? "Gambar sedang dibuat" : "AI sedang menyusun jawaban"}
        />

        <ChatInput
          onSendMessage={handleSendMessage}
          onGenerateImage={handleGenerateImage}
          loading={loading}
          imageQuota={quota}
          latestImageReference={latestImageReference}
        />
      </div>
    </div>
  );
}
