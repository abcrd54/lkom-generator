"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function useConversations() {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [supabase] = useState(() => createClient());
  const router = useRouter();

  const refresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  const createConversation = useCallback(async (): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        title: "Chat Baru",
        model: "cx/gpt-5.5",
      })
      .select()
      .single();

    if (error || !data) return null;

    setCurrentId(data.id);
    refresh();
    return data.id;
  }, [supabase, refresh]);

  const selectConversation = useCallback((id: string) => {
    setCurrentId(id);
    router.push(`/chat/${id}`);
  }, [router]);

  const deleteConversation = useCallback(async (id: string) => {
    await supabase.from("conversations").delete().eq("id", id);
    if (currentId === id) {
      setCurrentId(null);
      router.push("/chat");
    }
    refresh();
  }, [supabase, currentId, router, refresh]);

  return {
    currentId,
    refreshTrigger,
    createConversation,
    selectConversation,
    deleteConversation,
    refresh,
  };
}
