import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("type", "image")
      .gte("created_at", today.toISOString());

    const used = count || 0;
    const remaining = 15 - used;

    const resetAt = new Date(today);
    resetAt.setDate(resetAt.getDate() + 1);

    return NextResponse.json({
      used,
      remaining: Math.max(0, remaining),
      resetAt: resetAt.toISOString(),
    });
  } catch (error) {
    console.error("Quota error:", error);
    return NextResponse.json({
      used: 0,
      remaining: 15,
      resetAt: new Date().toISOString(),
    });
  }
}
