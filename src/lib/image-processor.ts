import { randomUUID } from "crypto";
import { generateImage } from "@/lib/ai";
import { uploadToR2 } from "@/lib/r2";
import { createServiceClient } from "@/lib/supabase/service";
import type { ImageJobData, ImageJobResult } from "@/lib/image-jobs";

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

async function uploadReferenceImages(data: ImageJobData) {
  if (data.referenceImageUrl) {
    return [data.referenceImageUrl];
  }

  if (data.referenceImageUrls?.length) {
    return data.referenceImageUrls;
  }

  const sources = data.referenceImages?.length
    ? data.referenceImages
    : data.referenceImage
      ? [data.referenceImage]
      : [];

  if (!sources.length) {
    return undefined;
  }

  return Promise.all(
    sources.map(async (image, index) => {
      if (!image.dataUrl) {
        throw new Error("Missing reference image data URL.");
      }

      const { mimeType, buffer } = parseDataUrl(image.dataUrl);
      const extension =
        mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
            ? "webp"
            : "jpg";

      return uploadToR2({
        key: `references/${data.userId}/${randomUUID()}-${index}.${extension}`,
        body: buffer,
        contentType: mimeType,
      });
    })
  );
}

export async function processImageJob(data: ImageJobData): Promise<ImageJobResult> {
  const referenceImageUrls = await uploadReferenceImages(data);
  const referenceImageUrl =
    referenceImageUrls?.length === 1 ? referenceImageUrls[0] : undefined;

  const response = await generateImage({
    prompt: data.finalPrompt,
    fallbackPromptWithoutReferences: data.originalPrompt,
    model: PRIMARY_IMAGE_MODEL,
    size: "auto",
    quality: "medium",
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
  let contentType = "image/png";

  if (imageData.b64_json) {
    imageBuffer = Buffer.from(imageData.b64_json, "base64");
  } else if (imageData.url) {
    const imgResponse = await fetch(imageData.url);
    if (!imgResponse.ok) {
      throw new Error(`Failed to fetch generated image: ${imgResponse.status}`);
    }
    const arrayBuffer = await imgResponse.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuffer);
    contentType = imgResponse.headers.get("content-type") || "image/png";
  } else {
    throw new Error("Could not extract image from response");
  }

  const key = `images/${data.userId}/${randomUUID()}.png`;
  const imageUrl = await uploadToR2({
    key,
    body: imageBuffer,
    contentType,
  });

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
