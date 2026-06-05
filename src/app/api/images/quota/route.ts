import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error: quotaError } = await supabase.rpc("get_image_quota", {
      p_user_id: user.id,
    });

    if (quotaError) {
      throw quotaError;
    }

    const quota = Array.isArray(data) ? data[0] : data;

    const { data: profile } = await supabase
      .from("profiles")
      .select("daily_image_limit")
      .eq("id", user.id)
      .single();

    return NextResponse.json({
      used: quota?.used ?? 0,
      remaining: quota?.remaining ?? 0,
      limit: profile?.daily_image_limit ?? 15,
      resetAt: quota?.reset_at ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error("Quota error:", error);
    return NextResponse.json({
      used: 0,
      remaining: 15,
      limit: 15,
      resetAt: new Date().toISOString(),
    });
  }
}
