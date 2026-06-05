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

export default function ChatPage() {
  const router = useRouter();

  const { messages, loading: chatLoading, streamingContent, loadMessages, sendMessage, setMessages } = useChat();
  const { loading: imageLoading, quota, generateImage, fetchQuota } = useImageGen();
  const { createConversation, refreshTrigger, refresh } = useConversations();

  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  useEffect(() => {
    fetchQuota();

    // Check for latest conversation
    const fetchLatest = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      // Ensure profile exists
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email || "",
        full_name: user.user_metadata?.full_name || "",
      }, { onConflict: "id" });

      // Fetch latest conversation
      const { data } = await supabase
        .from("conversations")
        .select("id")
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setCurrentConversationId(data.id);
        loadMessages(data.id);
      }
    };
    fetchLatest();
  }, [fetchQuota, loadMessages, router]);

  const handleNewChat = useCallback(async () => {
    setCurrentConversationId(null);
    setMessages([]);
    router.push("/chat");
  }, [router, setMessages]);

  const handleSelectConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
    loadMessages(id);
    router.push(`/chat/${id}`);
  }, [router, loadMessages]);

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

    const supabase = createClient();
    await supabase.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: "",
      reference_images: options.referenceImages?.length ? options.referenceImages : null,
    });

    setMessages((prev) => [
      ...prev,
      {
        id: `user-img-${Date.now()}`,
        role: "user",
        content: "",
        referenceImages: options.referenceImages,
        createdAt: new Date().toISOString(),
      },
    ]);

    const result = await generateImage(options, convId);
    if (result) {
      setMessages((prev) => [...prev, result]);
      if (shouldNavigate) {
        router.replace(`/chat/${convId}`);
      }
      refresh();
    }
  }, [currentConversationId, ensureConversation, generateImage, setMessages, refresh, router]);

  const loading = chatLoading || imageLoading;

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
        />
      </div>
    </div>
  );
}
