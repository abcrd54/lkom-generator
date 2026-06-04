"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar, MobileSidebar } from "@/components/chat/sidebar";
import { useConversations } from "@/hooks/use-conversations";
import { createClient } from "@/lib/supabase/client";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { createConversation, refreshTrigger, refresh } = useConversations();
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAdmin = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      await supabase.rpc("ensure_profile");
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "admin") {
        router.push("/chat");
        return;
      }

      setIsAdmin(true);
      setLoading(false);
    };
    checkAdmin();
  }, [router]);

  const handleNewChat = useCallback(async () => {
    const newId = await createConversation();
    if (newId) {
      setCurrentConversationId(newId);
      refresh();
      router.push(`/chat/${newId}`);
    }
  }, [createConversation, refresh, router]);

  const handleSelectConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
    router.push(`/chat/${id}`);
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="text-sm text-muted-foreground">Memuat...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) return null;

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

      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
