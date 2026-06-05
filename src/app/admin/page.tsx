"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, MessageSquare, ImageIcon, Activity } from "lucide-react";

interface Stats {
  totalUsers: number;
  totalConversations: number;
  totalMessages: number;
  totalImages: number;
  todayImages: number;
  activeUsers: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchStats = useCallback(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [users, conversations, messages, images, todayImages, activeUsers] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("conversations").select("*", { count: "exact", head: true }),
        supabase.from("messages").select("*", { count: "exact", head: true }),
        supabase.from("images").select("*", { count: "exact", head: true }),
        supabase.from("images").select("*", { count: "exact", head: true }).gte("created_at", today.toISOString()),
        supabase.from("usage_logs").select("user_id", { count: "exact", head: true }).gte("created_at", today.toISOString()),
      ]);

      setStats({
        totalUsers: users.count || 0,
        totalConversations: conversations.count || 0,
        totalMessages: messages.count || 0,
        totalImages: images.count || 0,
        todayImages: todayImages.count || 0,
        activeUsers: activeUsers.count || 0,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(fetchStats);
  }, [fetchStats]);

  return (
    <div className="p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-blue-900">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview platform LKOM Generator</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="border-blue-100 animate-pulse">
                <CardContent className="h-24" />
              </Card>
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="border-blue-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
                <Users className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-900">{stats.totalUsers}</div>
                <Badge variant="secondary" className="mt-1 bg-blue-100 text-blue-700">
                  {stats.activeUsers} aktif hari ini
                </Badge>
              </CardContent>
            </Card>

            <Card className="border-blue-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Percakapan</CardTitle>
                <MessageSquare className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-900">{stats.totalConversations}</div>
                <p className="text-xs text-muted-foreground mt-1">{stats.totalMessages} total pesan</p>
              </CardContent>
            </Card>

            <Card className="border-blue-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Gambar Generated</CardTitle>
                <ImageIcon className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-900">{stats.totalImages}</div>
                <Badge variant="secondary" className="mt-1 bg-green-100 text-green-700">
                  {stats.todayImages} hari ini
                </Badge>
              </CardContent>
            </Card>

            <Card className="border-blue-100">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Usage Hari Ini</CardTitle>
                <Activity className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-900">{stats.activeUsers}</div>
                <p className="text-xs text-muted-foreground mt-1">request hari ini</p>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
