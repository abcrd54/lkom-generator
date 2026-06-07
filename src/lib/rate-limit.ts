import { createClient } from "@/lib/supabase/server";

const DAILY_IMAGE_LIMIT = 15;

export async function checkImageRateLimit(userId: string): Promise<{
  allowed: boolean;
  used: number;
  remaining: number;
  resetAt: string;
}> {
  try {
    const supabase = await createClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: profile } = await supabase
      .from("profiles")
      .select("daily_image_limit")
      .eq("id", userId)
      .single();

    const dailyLimit = profile?.daily_image_limit ?? DAILY_IMAGE_LIMIT;

    const { count } = await supabase
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("type", "image")
      .gte("created_at", today.toISOString());

    const used = count || 0;
    const remaining = dailyLimit - used;
    const resetAt = new Date(today);
    resetAt.setDate(resetAt.getDate() + 1);

    return {
      allowed: remaining > 0,
      used,
      remaining: Math.max(0, remaining),
      resetAt: resetAt.toISOString(),
    };
  } catch (error) {
    console.error("Rate limit check error:", error);
    return {
      allowed: true,
      used: 0,
      remaining: DAILY_IMAGE_LIMIT,
      resetAt: new Date().toISOString(),
    };
  }
}

export async function logImageUsage(userId: string, model: string): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from("usage_logs").insert({
      user_id: userId,
      type: "image",
      model,
      tokens: 0,
    });
  } catch (error) {
    console.error("Failed to log image usage:", error);
  }
}
