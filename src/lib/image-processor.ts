import { generateImage } from "@/lib/ai";
import { createServiceClient } from "@/lib/supabase/service";
import type { ImageJobData, ImageJobResult } from "@/lib/image-jobs";
import http from "node:http";

const PRIMARY_IMAGE_MODEL = "cx/gpt-5.5-image";

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid reference image data URL.");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function uploadToGoProxy(buffer: Buffer, extension: string): Promise<string> {
  const goProxyUrl = process.env.GO_PROXY_URL || "http://localhost:20129";
  const b64 = buffer.toString("base64");

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ data: b64, extension });
    const url = new URL(`${goProxyUrl}/upload`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 20129,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const total = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          reject(new Error(`Go proxy upload failed: ${res.statusCode} ${total.toString()}`));
          return;
        }
        try {
          const json = JSON.parse(total.toString()) as { url?: string };
          if (json.url) {
            resolve(json.url);
          } else {
            reject(new Error("Go proxy upload returned no URL"));
          }
        } catch {
          reject(new Error("Go proxy upload returned invalid JSON"));
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Upload timeout")); });
    req.write(body);
    req.end();
  });
}

async function uploadReferenceImages(data: ImageJobData): Promise<string[] | undefined> {
  const sources = data.referenceImages?.length
    ? data.referenceImages.map((img) => img.dataUrl || img.url || "")
    : data.referenceImage?.dataUrl
      ? [data.referenceImage.dataUrl]
      : data.referenceImageUrls?.length
        ? data.referenceImageUrls
        : data.referenceImageUrl
          ? [data.referenceImageUrl]
          : [];

  if (!sources.length) {
    return undefined;
  }

  console.log(`[ImageProcessor] Processing ${sources.length} reference images`);

  const results: string[] = [];
  for (const source of sources) {
    if (!source) continue;

    if (source.startsWith("data:")) {
      console.log(`[ImageProcessor] Uploading data URL (${source.length} chars) to Go proxy`);
      const { mimeType, buffer } = parseDataUrl(source);
      const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const url = await uploadToGoProxy(buffer, extension);
      console.log(`[ImageProcessor] Uploaded to Go proxy: ${url}`);
      results.push(url);
    } else if (/^https?:\/\//i.test(source)) {
      console.log(`[ImageProcessor] Using URL directly: ${source.slice(0, 80)}`);
      results.push(source);
    }
  }

  return results.length ? results : undefined;
}

export async function processImageJob(data: ImageJobData): Promise<ImageJobResult> {
  try {
    return await doProcessImageJob(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui.";
    console.error(`[ImageProcessor] Job failed for user ${data.userId}:`, errorMessage);

    try {
      const supabase = createServiceClient();
      await supabase.from("messages").insert({
        conversation_id: data.conversationId,
        role: "assistant",
        content: `Maaf, gambar gagal dibuat. ${errorMessage.includes("timeout") ? "Server sedang sibuk, silakan coba lagi." : "Silakan coba lagi nanti."}`,
        model: "error",
      });
    } catch (saveError) {
      console.error("[ImageProcessor] Failed to save error message:", saveError);
    }

    throw error;
  }
}

async function doProcessImageJob(data: ImageJobData): Promise<ImageJobResult> {
  const referenceImageUrls = await uploadReferenceImages(data);
  const referenceImageUrl =
    referenceImageUrls?.length === 1 ? referenceImageUrls[0] : undefined;

  const response = await generateImage({
    prompt: data.finalPrompt,
    fallbackPromptWithoutReferences: data.originalPrompt,
    model: PRIMARY_IMAGE_MODEL,
    size: "auto",
    quality: "auto",
    background: "auto",
    image_detail: "high",
    output_format: "png",
    referenceImageUrl,
    referenceImageUrls: referenceImageUrl ? undefined : referenceImageUrls,
  });
  const usedModel =
    typeof response?._meta?.model === "string" && response._meta.model
      ? response._meta.model
      : PRIMARY_IMAGE_MODEL;

  const imageData = response?.data?.[0];
  if (!imageData) {
    throw new Error("No image generated");
  }

  let imageBuffer: Buffer;

  if (imageData.b64_json) {
    imageBuffer = Buffer.from(imageData.b64_json, "base64");
  } else if (imageData.url) {
    const imgResponse = await fetch(imageData.url);
    if (!imgResponse.ok) {
      throw new Error(`Failed to fetch generated image: ${imgResponse.status}`);
    }
    const arrayBuffer = await imgResponse.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuffer);
  } else {
    throw new Error("Could not extract image from response");
  }

  const imageUrl = await uploadToGoProxy(imageBuffer, "png");

  const supabase = createServiceClient();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { data: savedMessage, error: messageError } = await supabase
    .from("messages")
    .insert({
      conversation_id: data.conversationId,
      role: "assistant",
      content: "",
      model: usedModel,
    })
    .select("id, created_at")
    .single();

  if (messageError || !savedMessage) {
    throw new Error(messageError?.message || "Failed to save image message");
  }

  const { data: savedImage, error: imageError } = await supabase
    .from("images")
    .insert({
      message_id: savedMessage.id,
      user_id: data.userId,
      r2_url: imageUrl,
      prompt: data.originalPrompt,
      style: data.style,
      age_group: data.ageGroup,
      aspect_ratio: data.aspectRatio,
      detail_level: data.detailLevel,
      color_theme: data.colorTheme,
      language: data.language,
      watermark: data.watermark || null,
      model: usedModel,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (imageError || !savedImage) {
    throw new Error(imageError?.message || "Failed to save image metadata");
  }

  await supabase.from("usage_logs").insert({
    user_id: data.userId,
    type: "image",
    model: usedModel,
    tokens: 0,
  });

  return {
    imageUrl,
    imageId: savedImage.id,
    messageId: savedMessage.id,
    model: usedModel,
    prompt: data.originalPrompt,
    metadata: {
      style: data.style,
      ageGroup: data.ageGroup,
      aspectRatio: data.aspectRatio,
      detailLevel: data.detailLevel,
      colorTheme: data.colorTheme,
      language: data.language,
      watermark: data.watermark,
    },
  };
}
