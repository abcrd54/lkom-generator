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

    // Use atomic database function (no race condition)
    const { data, error } = await supabase.rpc("check_and_log_image_usage", {
      p_user_id: userId,
      p_model: "cx/gpt-5.5-image",
    });

    if (error) {
      console.error("Rate limit RPC error:", error);
      // Fallback to simple check if function doesn't exist yet
      return await fallbackRateLimit(userId);
    }

    return {
      allowed: data.allowed,
      used: data.used,
      remaining: data.remaining,
      resetAt: data.reset_at,
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

// Fallback for when DB function doesn't exist yet
async function fallbackRateLimit(userId: string): Promise<{
  allowed: boolean;
  used: number;
  remaining: number;
  resetAt: string;
}> {
  const supabase = await createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("usage_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "image")
    .gte("created_at", today.toISOString());

  const used = count || 0;
  const remaining = DAILY_IMAGE_LIMIT - used;
  const resetAt = new Date(today);
  resetAt.setDate(resetAt.getDate() + 1);

  // Still insert if allowed (non-atomic, but better than nothing)
  if (remaining > 0) {
    await supabase.from("usage_logs").insert({
      user_id: userId,
      type: "image",
      model: "cx/gpt-5.5-image",
      tokens: 0,
    });
  }

  return {
    allowed: remaining > 0,
    used,
    remaining: Math.max(0, remaining),
    resetAt: resetAt.toISOString(),
  };
}
