"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  Edit3,
  LogOut,
  GraduationCap,
  ChevronLeft,
  User,
  LayoutDashboard,
  Users,
  BarChart3,
  Shield,
} from "lucide-react";
import type { Conversation, Profile } from "@/types";
import { formatDistanceToNow } from "date-fns";
import { id } from "date-fns/locale";

interface SidebarProps {
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  refreshTrigger: number;
}

export function Sidebar({ currentConversationId, onSelectConversation, onNewChat, refreshTrigger }: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  const isAdmin = profile?.role === "admin";
  const isAdminPage = pathname.startsWith("/admin");

  const fetchConversations = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("last_message_at", { ascending: false });

      if (!error && data) {
        setConversations(data);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, [supabase]);

  const fetchProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Upsert profile to ensure it exists
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email || "",
        full_name: user.user_metadata?.full_name || "",
      }, { onConflict: "id" });

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (data) setProfile(data);
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      fetchConversations();
      fetchProfile();
    });
  }, [fetchConversations, fetchProfile, refreshTrigger]);

  const handleDelete = async (id: string) => {
    await supabase.from("conversations").delete().eq("id", id);
    if (currentConversationId === id) {
      onNewChat();
    }
    fetchConversations();
  };

  const handleRename = async (id: string) => {
    if (editTitle.trim()) {
      await supabase
        .from("conversations")
        .update({ title: editTitle.trim() })
        .eq("id", id);
      setEditingId(null);
      fetchConversations();
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex h-full w-72 flex-col border-r border-blue-100 bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-2 p-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
          <GraduationCap className="h-4 w-4 text-white" />
        </div>
        <span className="font-semibold text-blue-900">LKOM Generator</span>
        {isAdmin && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
            <Shield className="h-2.5 w-2.5" />
            Admin
          </span>
        )}
      </div>

      {/* Admin Navigation (only for admin) */}
      {isAdmin && (
        <>
          <div className="px-3 pb-2 space-y-1">
            <button
              onClick={() => router.push("/admin")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                pathname === "/admin"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-blue-50"
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </button>
            <button
              onClick={() => router.push("/admin/users")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                pathname === "/admin/users"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-blue-50"
              }`}
            >
              <Users className="h-4 w-4" />
              Kelola Users
            </button>
            <button
              onClick={() => router.push("/admin/usage")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                pathname === "/admin/usage"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-blue-50"
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              Usage Analytics
            </button>
          </div>
          <Separator className="bg-blue-100" />
        </>
      )}

      {/* Action Buttons */}
      <div className="px-3 pb-2 pt-2">
        <Button
          onClick={() => {
            onNewChat();
            if (isAdminPage) router.push("/chat");
          }}
          variant="outline"
          className="w-full justify-start gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
        >
          <Plus className="h-4 w-4" />
          Chat Baru
        </Button>
      </div>

      <Separator className="bg-blue-100" />

      {/* Conversation List */}
      <ScrollArea className="flex-1 px-2 py-2">
        {loading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Belum ada percakapan
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                  currentConversationId === conv.id && !isAdminPage
                    ? "bg-blue-100 text-blue-900"
                    : "hover:bg-blue-50 text-slate-700"
                }`}
                onClick={() => {
                  onSelectConversation(conv.id);
                  if (isAdminPage) router.push(`/chat/${conv.id}`);
                }}
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-blue-500" />
                <div className="flex-1 min-w-0">
                  {editingId === conv.id ? (
                    <input
                      autoFocus
                      className="w-full bg-white rounded px-1 py-0.5 text-sm border border-blue-300 outline-none"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleRename(conv.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(conv.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="truncate text-sm font-medium">{conv.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(conv.last_message_at), {
                          addSuffix: true,
                          locale: id,
                        })}
                      </div>
                    </>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-blue-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(conv.id);
                        setEditTitle(conv.title);
                      }}
                    >
                      <Edit3 className="mr-2 h-3 w-3" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(conv.id);
                      }}
                    >
                      <Trash2 className="mr-2 h-3 w-3" />
                      Hapus
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <Separator className="bg-blue-100" />

      {/* User Profile */}
      <div className="p-3">
        <div className="mb-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">
          Menggunakan Teknologi CHATGPT PLUS
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 hover:bg-blue-50 transition-colors">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${isAdmin ? "bg-blue-600" : "bg-blue-200"}`}>
              {isAdmin ? (
                <Shield className="h-4 w-4 text-white" />
              ) : (
                <User className="h-4 w-4 text-blue-700" />
              )}
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="truncate text-sm font-medium">
                {profile?.full_name || "Guru"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {profile?.email || ""}
              </div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <div className="text-sm font-medium">{profile?.full_name || "Guru"}</div>
              <div className="text-xs text-muted-foreground">{profile?.email}</div>
              {isAdmin && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                  <Shield className="h-2.5 w-2.5" />
                  Super Admin
                </span>
              )}
            </div>
            <DropdownMenuSeparator />
            {isAdmin && (
              <>
                <DropdownMenuItem onClick={() => router.push("/admin")}>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  Admin Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/admin/users")}>
                  <Users className="mr-2 h-4 w-4" />
                  Kelola Users
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/admin/usage")}>
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Usage Analytics
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => router.push("/chat")}>
              <MessageSquare className="mr-2 h-4 w-4" />
              Chat Saya
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function MobileSidebar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="fixed left-3 top-3 z-50 md:hidden"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronLeft className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
      </Button>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full">{children}</div>
        </div>
      )}
    </>
  );
}
