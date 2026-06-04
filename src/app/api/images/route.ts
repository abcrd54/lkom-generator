import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateImage } from "@/lib/ai";
import { buildImagePrompt } from "@/lib/prompts";
import { checkImageRateLimit } from "@/lib/rate-limit";
import { uploadToR2 } from "@/lib/r2";
import { imageQueue } from "@/lib/queue";
import { randomUUID } from "crypto";
import type { ImageStyle, AgeGroup, AspectRatio, DetailLevel, ImageLanguage } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check rate limit
    const rateLimit = await checkImageRateLimit(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Kuota gambar harian habis", resetAt: rateLimit.resetAt },
        { status: 429 }
      );
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
    } = body as {
      prompt: string;
      style: ImageStyle;
      ageGroup: AgeGroup;
      aspectRatio: AspectRatio;
      detailLevel: DetailLevel;
      colorTheme: string;
      language: ImageLanguage;
      watermark?: string;
    };

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    // Build final prompt
    const finalPrompt = buildImagePrompt({
      userPrompt: prompt,
      style,
      ageGroup,
      detailLevel,
      colorTheme,
      language,
      watermark,
    });

    try {
      // Queue: max 3 concurrent image generations to 9Router
      const response = await imageQueue.add(() =>
        generateImage({
          prompt: finalPrompt,
          model: "cx/gpt-5.5-image",
          size: "auto",
          quality: "medium",
          background: "auto",
          image_detail: "high",
          output_format: "png",
        })
      );

      // Extract image from response
      const imageData = response?.data?.[0];
      if (!imageData) {
        return NextResponse.json({ error: "No image generated", raw: response }, { status: 500 });
      }

      let imageBuffer: Buffer;
      let contentType = "image/png";

      if (imageData.b64_json) {
        imageBuffer = Buffer.from(imageData.b64_json, "base64");
      } else if (imageData.url) {
        const imgResponse = await fetch(imageData.url);
        const arrayBuffer = await imgResponse.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
        contentType = imgResponse.headers.get("content-type") || "image/png";
      } else {
        return NextResponse.json({ error: "Could not extract image from response" }, { status: 500 });
      }

      // Upload to R2
      const key = `images/${user.id}/${randomUUID()}.png`;
      const imageUrl = await uploadToR2({
        key,
        body: imageBuffer,
        contentType,
      });

      // Save to database
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { data: savedImage } = await supabase
        .from("images")
        .insert({
          user_id: user.id,
          r2_url: imageUrl,
          prompt: finalPrompt,
          style,
          age_group: ageGroup,
          aspect_ratio: aspectRatio,
          detail_level: detailLevel,
          color_theme: colorTheme,
          language,
          watermark: watermark || null,
          model: "cx/gpt-5.5-image",
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      // Usage already logged by atomic rate limit function

      return NextResponse.json({
        imageUrl,
        imageId: savedImage?.id,
        prompt: finalPrompt,
        metadata: { style, ageGroup, aspectRatio, detailLevel, colorTheme, language, watermark },
        queue: imageQueue.stats,
      });
    } catch (queueError) {
      if (queueError instanceof Error && queueError.message === "Queue penuh") {
        return NextResponse.json(
          { error: "Server sibuk, coba lagi dalam beberapa saat" },
          { status: 503 }
        );
      }
      throw queueError;
    }
  } catch (error) {
    console.error("Image generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal generate gambar" },
      { status: 500 }
    );
  }
}
