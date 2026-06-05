import OpenAI from "openai";

export function create9RouterClient() {
  return new OpenAI({
    baseURL: process.env.NINEROUTER_BASE_URL
      ? `${process.env.NINEROUTER_BASE_URL}/v1`
      : "http://localhost:20128/v1",
    apiKey: process.env.NINEROUTER_API_KEY || "sk_9router",
  });
}

export async function streamChat(params: {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  model?: string;
  signal?: AbortSignal;
}) {
  const client = create9RouterClient();

  const stream = await client.chat.completions.create(
    {
      model: params.model || "cx/gpt-5.5",
      messages: params.messages,
      stream: true,
    },
    { signal: params.signal }
  );

  return stream;
}

export async function generateImage(params: {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  background?: string;
  image_detail?: string;
  output_format?: string;
  referenceImageDataUrl?: string;
}) {
  const apiKey = process.env.NINEROUTER_API_KEY || "sk_9router";
  const baseURL = process.env.NINEROUTER_BASE_URL
    ? `${process.env.NINEROUTER_BASE_URL}/v1`
    : "http://localhost:20128/v1";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180 detik timeout

  try {
    console.log(`[ImageGen] Starting request to ${baseURL}/images/generations`);
    console.log(`[ImageGen] Model: ${params.model}, Size: ${params.size}`);

    const basePayload = {
      model: params.model || "cx/gpt-5.5-image",
      prompt: params.prompt,
      n: 1,
      size: params.size || "auto",
      quality: "medium",
      background: "auto",
      image_detail: "high",
      output_format: "png",
    };

    const payload = params.referenceImageDataUrl
      ? {
          ...basePayload,
          input_image: params.referenceImageDataUrl,
        }
      : basePayload;

    let response = await fetch(`${baseURL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok && params.referenceImageDataUrl && response.status === 400) {
      const errorText = await response.text();
      console.warn("[ImageGen] Reference image rejected, retrying without input_image:", errorText);
      response = await fetch(`${baseURL}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(basePayload),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);
    console.log(`[ImageGen] Response status: ${response.status}`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Image generation failed: ${response.status} ${error}`);
    }

    const result = await response.json();
    console.log(`[ImageGen] Success, got ${result?.data?.length || 0} images`);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`[ImageGen] Error:`, error);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Image generation timeout (>180 detik)");
    }
    throw error;
  }
}
