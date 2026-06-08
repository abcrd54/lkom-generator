import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkImageRateLimit } from "@/lib/rate-limit";
import { getImageQueue } from "@/lib/image-jobs";
import type { ImageStyle, AgeGroup, AspectRatio, DetailLevel, ImageLanguage, ReferenceImage } from "@/types";

type MessageWithImages = {
  images?: {
    r2_url: string | null;
    expires_at: string | null;
    storage_deleted_at?: string | null;
  }[] | null;
};

function isContinuationPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  return [
    /\b(lanjutkan|lanjutin|continue)\b/,
    /\b(gambar|image|foto|ilustrasi)\s+(sebelumnya|tadi|itu|terakhir)\b/,
    /\b(sebelumnya|tadi|itu|terakhir)\s+(ubah|ganti|revisi|edit|perbaiki)\b/,
    /\b(ubah|ganti|revisi|edit|perbaiki)\b/,
    /\b(versi|variasi)\s+(lain|baru|berikutnya|selanjutnya)\b/,
    /\b(karakter|tokoh|style|gaya|komposisi)\s+(yang\s+)?sama\b/,
    /\bpertahankan\b/,
  ].some((pattern) => pattern.test(normalized));
}

async function findLatestAssistantImageUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: string
) {
  const { data } = await supabase
    .from("messages")
    .select("images(r2_url, expires_at, storage_deleted_at)")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(20);

  const rows = (data || []) as MessageWithImages[];
  for (const row of rows) {
    const image = Array.isArray(row.images) ? row.images[0] : undefined;
    if (!image?.r2_url || image.storage_deleted_at) continue;
    if (image.expires_at && new Date(image.expires_at).getTime() <= Date.now()) continue;
    return image.r2_url;
  }

  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse body with error handling
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const {
      prompt,
      style = "cartoon",
      ageGroup = "sd",
      aspectRatio = "1:1",
      detailLevel = "medium",
      colorTheme = "blue",
      language = "id",
      watermark,
      conversationId,
      referenceImage,
      referenceImageUrl,
      referenceImages,
      referenceImageUrls,
    } = body as {
      prompt: string;
      style: ImageStyle;
      ageGroup: AgeGroup;
      aspectRatio: AspectRatio;
      detailLevel: DetailLevel;
      colorTheme: string;
      language: ImageLanguage;
      watermark?: string;
      conversationId?: string;
      referenceImage?: ReferenceImage;
      referenceImageUrl?: string;
      referenceImages?: ReferenceImage[];
      referenceImageUrls?: string[];
    };

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const finalPrompt = prompt.trim();

    if (!conversationId) {
      return NextResponse.json({ error: "Conversation ID is required" }, { status: 400 });
    }

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Check rate limit only after the request is valid. This function logs
    // usage atomically, so calling it earlier would charge invalid requests.
    const rateLimit = await checkImageRateLimit(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Kuota gambar harian habis", resetAt: rateLimit.resetAt },
        { status: 429 }
      );
    }

    const normalizedReferenceImages = Array.isArray(referenceImages)
      ? referenceImages
      : referenceImage
        ? [referenceImage]
        : [];
    const normalizedReferenceImageUrls = Array.isArray(referenceImageUrls)
      ? referenceImageUrls.filter(Boolean)
      : referenceImageUrl
        ? [referenceImageUrl]
        : normalizedReferenceImages
            .map((image) => image.url)
            .filter((value): value is string => typeof value === "string" && value.length > 0);

    const continuationReferenceImageUrl =
      normalizedReferenceImages.length === 0 &&
      normalizedReferenceImageUrls.length === 0 &&
      isContinuationPrompt(finalPrompt)
        ? await findLatestAssistantImageUrl(supabase, conversationId)
        : undefined;
    const effectiveReferenceImageUrls = continuationReferenceImageUrl
      ? [continuationReferenceImageUrl]
      : normalizedReferenceImageUrls;

    if (Math.max(normalizedReferenceImages.length, effectiveReferenceImageUrls.length) > 3) {
      return NextResponse.json({ error: "Maksimal 3 gambar referensi" }, { status: 400 });
    }

    const allowedReferenceTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    const hasInvalidReference = normalizedReferenceImages.some(
      (image) => !allowedReferenceTypes.has(image.mimeType)
    );

    if (hasInvalidReference) {
      return NextResponse.json({ error: "Format gambar referensi harus JPG, PNG, atau WEBP" }, { status: 400 });
    }

    if (
      normalizedReferenceImages.some(
        (image) => image.dataUrl && image.dataUrl.length > 8_000_000
      )
    ) {
      return NextResponse.json({ error: "Ukuran gambar referensi terlalu besar" }, { status: 400 });
    }

    const queue = getImageQueue();
    const counts = await queue.getJobCounts("waiting", "delayed", "active", "paused");
    const queued = counts.waiting + counts.delayed + counts.active + counts.paused;
    const maxQueueSize = Number.parseInt(process.env.IMAGE_QUEUE_MAX_SIZE || "500", 10);

    if (queued >= maxQueueSize) {
      return NextResponse.json(
        { error: "Server sibuk, coba lagi dalam beberapa saat" },
        { status: 503 }
      );
    }

    const job = await queue.add("generate", {
      userId: user.id,
      conversationId,
      originalPrompt: prompt,
      finalPrompt,
      style,
      ageGroup,
      aspectRatio,
      detailLevel,
      colorTheme,
      language,
      watermark,
      referenceImageUrl:
        effectiveReferenceImageUrls.length === 1 ? effectiveReferenceImageUrls[0] : undefined,
      referenceImageUrls:
        effectiveReferenceImageUrls.length > 1 ? effectiveReferenceImageUrls : undefined,
      referenceImages: normalizedReferenceImages.length ? normalizedReferenceImages : undefined,
    });

    return NextResponse.json(
      {
        jobId: job.id,
        status: "queued",
        queue: {
          waiting: counts.waiting,
          active: counts.active,
          delayed: counts.delayed,
        },
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Image generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal generate gambar" },
      { status: 500 }
    );
  }
}
