import OpenAI from "openai";

const DEFAULT_IMAGE_MODEL = "cx/gpt-5.5-image";
const FALLBACK_IMAGE_MODELS = [DEFAULT_IMAGE_MODEL, "cx/gpt-5.4-image"];

function isCodexImageModel(model: string) {
  return model.startsWith("cx/") || model.startsWith("codex/");
}

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

function parseSsePayload(body: string) {
  const events = body
    .split(/\r?\n\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  let lastJsonText: string | null = null;
  let partialImageBase64: string | null = null;

  for (const eventChunk of events) {
    const lines = eventChunk.split(/\r?\n/);
    const eventName =
      lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "";
    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    if (dataLines.length === 0) {
      continue;
    }

    const joined = dataLines.join("\n");
    if (joined === "[DONE]") {
      continue;
    }

    try {
      const parsed = JSON.parse(joined);
      if (Array.isArray(parsed?.data) && parsed.data.length > 0) {
        lastJsonText = joined;
      }

      if (typeof parsed?.b64_json === "string" && parsed.b64_json.length > 0) {
        partialImageBase64 = parsed.b64_json;
      }

      if (eventName === "response.output_item.done" && Array.isArray(parsed?.item?.result)) {
        const imageItem = parsed.item.result.find(
          (item: unknown) =>
            item &&
            typeof item === "object" &&
            ("b64_json" in item || "url" in item)
        ) as { b64_json?: string; url?: string } | undefined;

        if (imageItem) {
          console.log("[ImageGen] SSE parser using response.output_item.done result");
          return { data: [imageItem] };
        }
      }
    } catch {
      // Ignore non-JSON event payloads and keep scanning for the final image event.
    }
  }

  if (partialImageBase64) {
    console.log("[ImageGen] SSE parser using partial_image fallback");
    return {
      data: [{ b64_json: partialImageBase64 }],
    };
  }

  if (!lastJsonText) {
    throw new Error("Image generation returned an empty SSE payload.");
  }

  return JSON.parse(lastJsonText);
}

async function parseImageGenerationResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();

  if (contentType.includes("text/event-stream") || rawBody.trimStart().startsWith("event:")) {
    return parseSsePayload(rawBody);
  }

  return JSON.parse(rawBody);
}

export async function generateImage(params: {
  prompt: string;
  fallbackPromptWithoutReferences?: string;
  model?: string;
  size?: string;
  quality?: string;
  background?: string;
  image_detail?: string;
  output_format?: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
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

  const executeRequest = async (
    payload: Record<string, unknown>,
    accept: "application/json" | "text/event-stream" = "application/json"
  ) => {
    return fetch(`${baseURL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: accept,
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
    console.log(`[ImageGen] API key prefix: ${apiKey.slice(0, 12)}`);

    const referenceImages =
      params.referenceImageUrl
        ? [params.referenceImageUrl]
        : params.referenceImageUrls?.length
        ? params.referenceImageUrls
        : params.referenceImageDataUrls?.length
        ? params.referenceImageDataUrls
        : params.referenceImageDataUrl
          ? [params.referenceImageDataUrl]
          : [];

    let lastError: Error | null = null;

    for (const model of candidateModels) {
      const useSseFirst = isCodexImageModel(model);
      const basePayload = {
        model,
        prompt: params.prompt,
        n: 1,
        size: params.size || "auto",
        quality: params.quality || "auto",
        background: params.background || "auto",
        image_detail: params.image_detail || "high",
        output_format: params.output_format || "png",
      };
      const noReferencePayload = {
        ...basePayload,
        prompt: params.fallbackPromptWithoutReferences || params.prompt,
      };

      console.log(
        `[ImageGen] Payload config -> model=${model}, size=${String(basePayload.size)}, quality=${String(
          basePayload.quality
        )}, background=${String(basePayload.background)}, image_detail=${String(
          basePayload.image_detail
        )}, output_format=${String(basePayload.output_format)}, references=${referenceImages.length}, reference_source=${
          referenceImages.length
            ? referenceImages.every((image) => typeof image === "string" && /^https?:\/\//i.test(image))
              ? "url"
              : "dataurl"
            : "none"
        }, transport=${useSseFirst ? "sse" : "json"}`
      );

      const payload = referenceImages.length
        ? referenceImages.length === 1
          ? {
              ...basePayload,
              image: referenceImages[0],
            }
          : isCodexImageModel(model)
            ? {
                ...basePayload,
                images: referenceImages,
              }
            : {
                ...basePayload,
                image: referenceImages,
              }
        : basePayload;
      const hasReferencePayload = referenceImages.length > 0;
      let attemptedWithoutReference = !hasReferencePayload;

      let response = await executeRequest(payload, useSseFirst ? "text/event-stream" : "application/json");

      if (!response.ok && referenceImages.length > 1 && response.status === 400) {
        const errorText = await response.text();
        console.warn(`[ImageGen] ${model} rejected multiple references, retrying with first input_image:`, errorText);
        response = await executeRequest({
          ...basePayload,
          image: referenceImages[0],
        }, useSseFirst ? "text/event-stream" : "application/json");
      }

      if (!response.ok && hasReferencePayload && response.status === 400) {
        const errorText = await response.text();
        console.warn(`[ImageGen] ${model} rejected reference image, retrying without image:`, errorText);
        attemptedWithoutReference = true;
        response = await executeRequest(noReferencePayload, useSseFirst ? "text/event-stream" : "application/json");
      }

      if (!response.ok && hasReferencePayload && !attemptedWithoutReference) {
        const errorText = await response.text();

        if (shouldFallbackModel(response.status, errorText)) {
          console.warn(
            `[ImageGen] ${model} failed with reference image, retrying once without image:`,
            errorText
          );
          attemptedWithoutReference = true;
          response = await executeRequest(noReferencePayload, useSseFirst ? "text/event-stream" : "application/json");
        } else {
          response = new Response(errorText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      }

      console.log(`[ImageGen] Model ${model} response status: ${response.status}`);

      if (response.ok) {
        try {
          clearTimeout(timeoutId);
          const result = await parseImageGenerationResponse(response);
          console.log(`[ImageGen] Success with ${model}, got ${result?.data?.length || 0} images`);
          return {
            ...result,
            _meta: {
              model,
              fallbackUsed: model !== requestedModel,
            },
          };
        } catch (parseError) {
          if (useSseFirst) {
            throw parseError instanceof Error ? parseError : new Error("Failed to parse SSE image response.");
          }

          const parseMessage =
            parseError instanceof Error ? parseError.message : "Unknown image response parse error.";

          console.warn(
            `[ImageGen] Failed to parse JSON response for ${model}, retrying with SSE Accept header: ${parseMessage}`
          );

          response = await executeRequest(payload, "text/event-stream");
          console.log(`[ImageGen] Model ${model} SSE retry response status: ${response.status}`);

          if (!response.ok) {
            const retryErrorText = await response.text();
            throw new Error(`Image generation failed after SSE retry: ${response.status} ${retryErrorText}`);
          }

          clearTimeout(timeoutId);
          const result = await parseImageGenerationResponse(response);
          console.log(`[ImageGen] Success with ${model} after SSE retry, got ${result?.data?.length || 0} images`);
          return {
            ...result,
            _meta: {
              model,
              fallbackUsed: model !== requestedModel,
            },
          };
        }
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
