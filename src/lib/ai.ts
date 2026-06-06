import OpenAI from "openai";

const DEFAULT_IMAGE_MODEL = "cx/gpt-5.5-image";
const FALLBACK_IMAGE_MODELS = [DEFAULT_IMAGE_MODEL, "cx/gpt-5.4-image"];

function normalize9RouterBaseURL(rawValue?: string) {
  const fallback = "http://localhost:20128";
  const value = rawValue?.trim();
  if (!value) return fallback;

  const sanitized = value
    .replace(/\/:([0-9]+)(?=\/|$)/, ":$1")
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");

  try {
    const parsed = new URL(sanitized);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    const pathname = parsed.pathname === "/v1" ? "" : parsed.pathname;
    return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    if (/^https?:\/\//i.test(sanitized)) {
      return sanitized;
    }
    return `${fallback}${sanitized.startsWith("/") ? "" : "/"}${sanitized}`;
  }
}

function get9RouterBaseURL() {
  return normalize9RouterBaseURL(process.env.NINEROUTER_BASE_URL);
}

export function create9RouterClient() {
  const baseURL = get9RouterBaseURL();
  return new OpenAI({
    baseURL: `${baseURL}/v1`,
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
  referenceImageDataUrls?: string[];
}) {
  const apiKey = process.env.NINEROUTER_API_KEY || "sk_9router";
  const baseURL = `${get9RouterBaseURL()}/v1`;
  const requestedModel = params.model || DEFAULT_IMAGE_MODEL;
  const candidateModels = Array.from(
    new Set([
      requestedModel,
      ...((requestedModel === DEFAULT_IMAGE_MODEL && FALLBACK_IMAGE_MODELS.slice(1)) || []),
    ])
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180 detik timeout

  const executeRequest = async (payload: Record<string, unknown>) => {
    return fetch(`${baseURL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  };

  const shouldFallbackModel = (status: number, errorText: string) => {
    if (status >= 500 || status === 429) return true;

    const normalized = errorText.toLowerCase();
    return (
      normalized.includes("did not return an image") ||
      normalized.includes("not be entitled") ||
      normalized.includes("plus/pro required") ||
      normalized.includes("reset after")
    );
  };

  try {
    console.log(`[ImageGen] Starting request to ${baseURL}/images/generations`);
    console.log(`[ImageGen] Requested model: ${requestedModel}, Size: ${params.size}`);

    const referenceImages =
      params.referenceImageDataUrls?.length
        ? params.referenceImageDataUrls
        : params.referenceImageDataUrl
          ? [params.referenceImageDataUrl]
          : [];

    let lastError: Error | null = null;

    for (const model of candidateModels) {
      const basePayload = {
        model,
        prompt: params.prompt,
        n: 1,
        size: params.size || "auto",
        quality: "medium",
        background: "auto",
        image_detail: "high",
        output_format: "png",
      };

      const payload = referenceImages.length
        ? {
            ...basePayload,
            image: referenceImages.length === 1 ? referenceImages[0] : referenceImages,
          }
        : basePayload;

      let response = await executeRequest(payload);

      if (!response.ok && referenceImages.length > 1 && response.status === 400) {
        const errorText = await response.text();
        console.warn(`[ImageGen] ${model} rejected multiple references, retrying with first input_image:`, errorText);
        response = await executeRequest({
          ...basePayload,
          image: referenceImages[0],
        });
      }

      if (!response.ok && referenceImages.length && response.status === 400) {
        const errorText = await response.text();
        console.warn(`[ImageGen] ${model} rejected reference image, retrying without image:`, errorText);
        response = await executeRequest(basePayload);
      }

      console.log(`[ImageGen] Model ${model} response status: ${response.status}`);

      if (response.ok) {
        clearTimeout(timeoutId);
        const result = await response.json();
        console.log(`[ImageGen] Success with ${model}, got ${result?.data?.length || 0} images`);
        return {
          ...result,
          _meta: {
            model,
            fallbackUsed: model !== requestedModel,
          },
        };
      }

      const errorText = await response.text();
      const error = new Error(`Image generation failed: ${response.status} ${errorText}`);
      lastError = error;

      if (model !== candidateModels[candidateModels.length - 1] && shouldFallbackModel(response.status, errorText)) {
        console.warn(`[ImageGen] ${model} failed, retrying with fallback model.`);
        continue;
      }

      throw error;
    }

    throw lastError || new Error("Image generation failed");
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`[ImageGen] Error:`, error);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Image generation timeout (>180 detik)");
    }
    throw error;
  }
}
