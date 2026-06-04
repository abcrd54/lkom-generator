"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id } from "date-fns/locale";

interface UsageEntry {
  id: string;
  user_id: string;
  type: string;
  model: string;
  tokens: number;
  created_at: string;
  profiles?: { full_name: string; email: string };
}

export default function AdminUsagePage() {
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "text" | "image">("all");
  const supabase = createClient();

  const fetchUsage = useCallback(async () => {
    let query = supabase
      .from("usage_logs")
      .select("*, profiles(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (filter !== "all") {
      query = query.eq("type", filter);
    }

    const { data } = await query;
    if (data) setUsage(data as UsageEntry[]);
    setLoading(false);
  }, [supabase, filter]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  return (
    <div className="p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-blue-900">Usage Analytics</h1>
          <p className="text-sm text-muted-foreground">Monitor penggunaan platform</p>
        </div>

        <Card className="border-blue-100 mb-4">
          <CardContent className="pt-4">
            <div className="flex gap-2">
              {(["all", "text", "image"] as const).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className={filter === f ? "bg-blue-600" : "border-blue-200"}
                >
                  {f === "all" ? "Semua" : f === "text" ? "Text Chat" : "Image Gen"}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-100">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              100 aktivitas terbaru
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-blue-50" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Waktu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium text-sm">
                            {entry.profiles?.full_name || "Unknown"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {entry.profiles?.email || entry.user_id.slice(0, 8)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.type === "image"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-blue-100 text-blue-700"
                        }`}>
                          {entry.type === "image" ? "Gambar" : "Text"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.model}
                      </TableCell>
                      <TableCell className="text-sm">{entry.tokens || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.created_at), {
                          addSuffix: true,
                          locale: id,
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
