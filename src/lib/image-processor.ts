import { randomUUID } from "crypto";
import { generateImage } from "@/lib/ai";
import { uploadToR2 } from "@/lib/r2";
import { createServiceClient } from "@/lib/supabase/service";
import type { ImageJobData, ImageJobResult } from "@/lib/image-jobs";

const IMAGE_MODEL = "cx/gpt-5.5-image";

export async function processImageJob(data: ImageJobData): Promise<ImageJobResult> {
  const response = await generateImage({
    prompt: data.finalPrompt,
    model: IMAGE_MODEL,
    size: "auto",
    quality: "medium",
    background: "auto",
    image_detail: "high",
    output_format: "png",
    referenceImageDataUrls: data.referenceImages?.length
      ? data.referenceImages.map((image) => image.dataUrl)
      : data.referenceImage?.dataUrl
        ? [data.referenceImage.dataUrl]
        : undefined,
  });

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
      content: `Gambar: ${data.originalPrompt}`,
      model: IMAGE_MODEL,
      image_url: imageUrl,
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
      prompt: data.finalPrompt,
      style: data.style,
      age_group: data.ageGroup,
      aspect_ratio: data.aspectRatio,
      detail_level: data.detailLevel,
      color_theme: data.colorTheme,
      language: data.language,
      watermark: data.watermark || null,
      model: IMAGE_MODEL,
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
    prompt: data.finalPrompt,
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
