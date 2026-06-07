import OpenAI from "openai";
import http from "node:http";

const DEFAULT_IMAGE_MODEL = "cx/gpt-5.5-image";
const FALLBACK_IMAGE_MODELS = [DEFAULT_IMAGE_MODEL, "cx/gpt-5.4-image"];

function isCodexImageModel(model: string) {
  return model.startsWith("cx/") || model.startsWith("codex/");
}

function extractImageItem(value: unknown): { b64_json?: string; url?: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if ("b64_json" in value || "url" in value) {
    const item = value as { b64_json?: string; url?: string };
    if (typeof item.b64_json === "string" || typeof item.url === "string") {
      return item;
    }
  }

  if ("item" in value) {
    const nested = extractImageItem((value as { item?: unknown }).item);
    if (nested) return nested;
  }

  if ("result" in value && Array.isArray((value as { result?: unknown[] }).result)) {
    for (const entry of (value as { result: unknown[] }).result) {
      const nested = extractImageItem(entry);
      if (nested) return nested;
    }
  }

  if ("data" in value && Array.isArray((value as { data?: unknown[] }).data)) {
    for (const entry of (value as { data: unknown[] }).data) {
      const nested = extractImageItem(entry);
      if (nested) return nested;
    }
  }

  if ("output" in value && Array.isArray((value as { output?: unknown[] }).output)) {
    for (const entry of (value as { output: unknown[] }).output) {
      const nested = extractImageItem(entry);
      if (nested) return nested;
    }
  }

  if ("content" in value && Array.isArray((value as { content?: unknown[] }).content)) {
    for (const entry of (value as { content: unknown[] }).content) {
      const nested = extractImageItem(entry);
      if (nested) return nested;
    }
  }

  return null;
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

async function parseImageGenerationResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  const isSse = contentType.includes("text/event-stream");

  if (!isSse) {
    const rawBody = await response.text();
    if (rawBody.trimStart().startsWith("event:")) {
      return parseSseFromText(rawBody);
    }
    return JSON.parse(rawBody);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Image generation response body is not readable.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";
  let lastJsonText: string | null = null;
  let finalResult: { data: { b64_json?: string; url?: string }[] } | null = null;
  let eventCount = 0;
  let partialBase64 = "";
  let bytesRead = 0;

  function processEvent(eventName: string, data: string) {
    if (!data || data === "[DONE]") return;
    eventCount++;

    if (eventCount <= 2 || data.includes("b64_json") || data.includes('"url"') || data.length > 5000) {
      console.log(`[ImageGen] SSE event #${eventCount} [${eventName}]: len=${data.length}`);
    }

    try {
      const parsed = JSON.parse(data);
      const imageItem = extractImageItem(parsed);
      if (imageItem) {
        console.log(`[ImageGen] SSE stream found image in event: ${eventName}`);
        finalResult = { data: [imageItem] };
      }
      if (Array.isArray(parsed?.data) && parsed.data.length > 0) {
        lastJsonText = data;
      }
      if (eventName === "done" || eventName === "response.completed") {
        lastJsonText = data;
      }
      // Check for delta/text fields that might contain base64 image data
      const deltaText = parsed?.delta?.text || parsed?.delta || parsed?.text || "";
      if (typeof deltaText === "string" && deltaText.length > 500 && !deltaText.includes("{")) {
        console.log(`[ImageGen] SSE delta text found in [${eventName}]: len=${deltaText.length}`);
        partialBase64 += deltaText;
      }
    } catch {
      // non-JSON data - might be base64 text delta
      if (data.length > 500 && !data.includes("{")) {
        // Looks like raw base64 data
        console.log(`[ImageGen] SSE raw base64 chunk #${eventCount} [${eventName}]: len=${data.length}`);
        if (!partialBase64) partialBase64 = data;
        else partialBase64 += data;
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bytesRead += value.length;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData += (currentData ? "\n" : "") + line.slice(5).trim();
      } else if (line === "") {
        if (currentData) {
          processEvent(currentEvent, currentData);
          currentEvent = "";
          currentData = "";
        }
      }
    }
  }

  if (currentData) {
    processEvent(currentEvent, currentData);
  }

  console.log(`[ImageGen] SSE stream: ${eventCount} events, ${bytesRead} bytes, found=${!!finalResult}, partialBase64Len=${partialBase64.length}`);
  if (!finalResult && lastJsonText !== null) {
    console.log(`[ImageGen] SSE lastJsonText preview: ${String(lastJsonText).slice(0, 300)}`);
  }

  if (finalResult) return finalResult;
  if (partialBase64.length > 100) {
    console.log(`[ImageGen] SSE using assembled base64 from ${partialBase64.length} chars`);
    return { data: [{ b64_json: partialBase64 }] };
  }
  if (lastJsonText) return JSON.parse(lastJsonText);

  throw new Error("Image generation returned an empty SSE payload.");
}

function parseSseFromText(body: string) {
  const lines = body.split(/\r?\n/);
  let currentEvent = "";
  let currentData = "";
  let lastJsonText: string | null = null;

  for (const line of [...lines, ""]) {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      currentData += (currentData ? "\n" : "") + line.slice(5).trim();
    } else if (line === "") {
      if (currentData && currentData !== "[DONE]") {
        try {
          const parsed = JSON.parse(currentData);
          const imageItem = extractImageItem(parsed);
          if (imageItem) {
            console.log(`[ImageGen] SSE text found image in event: ${currentEvent}`);
            return { data: [imageItem] };
          }
          if (Array.isArray(parsed?.data) && parsed.data.length > 0) {
            lastJsonText = currentData;
          }
        } catch {
          // ignore
        }
      }
      currentEvent = "";
      currentData = "";
    }
  }

  if (lastJsonText) return JSON.parse(lastJsonText);
  throw new Error("Image generation returned an empty SSE payload.");
}

async function downloadAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download reference image from ${url}: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = res.headers.get("content-type") || "image/jpeg";
  return `data:${contentType};base64,${base64}`;
}

async function ensureDataUrls(images: string[]): Promise<string[]> {
  return Promise.all(
    images.map(async (image) => {
      if (image.startsWith("data:")) return image;
      if (/^https?:\/\//i.test(image)) return downloadAsDataUrl(image);
      return image;
    })
  );
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
  const hasReferenceInput = Boolean(
    params.referenceImageUrl ||
    params.referenceImageUrls?.length ||
    params.referenceImageDataUrl ||
    params.referenceImageDataUrls?.length
  );
  const defaultTimeoutMs = hasReferenceInput ? 420000 : 240000;
  const requestTimeoutMs = Number.parseInt(
    process.env.IMAGE_GENERATION_TIMEOUT_MS || String(defaultTimeoutMs),
    10
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  const useCodexBinary = isCodexImageModel(requestedModel);
  const goProxyUrl = process.env.GO_PROXY_URL || "http://localhost:20129";
  const imagesEndpoint = useCodexBinary
    ? `${baseURL}/images/generations?response_format=binary`
    : `${baseURL}/images/generations`;

  function executeCodexBinaryRequest(payload: Record<string, unknown>): Promise<Response> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const url = new URL(`${goProxyUrl}/generate`);
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
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          resolve(new Response(total, {
            status: res.statusCode || 200,
            statusText: res.statusMessage || "OK",
            headers,
          }));
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(600000, () => { req.destroy(); reject(new Error("Go proxy timeout")); });
      req.write(body);
      req.end();
    });
  }

  const executeRequest = async (
    payload: Record<string, unknown>,
  ) => {
    if (useCodexBinary) {
      return executeCodexBinaryRequest(payload);
    }
    const perRequestTimeout = 90000;
    const perController = new AbortController();
    const perTimer = setTimeout(() => perController.abort(), perRequestTimeout);
    try {
      const res = await fetch(imagesEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: perController.signal,
      });
      clearTimeout(perTimer);
      return res;
    } catch (err) {
      clearTimeout(perTimer);
      throw err;
    }
  };

  try {
    console.log(`[ImageGen] Starting request to ${baseURL}/images/generations`);
    console.log(`[ImageGen] Requested model: ${requestedModel}, Size: ${params.size}`);
    console.log(`[ImageGen] API key prefix: ${apiKey.slice(0, 12)}`);
    console.log(`[ImageGen] Request timeout: ${requestTimeoutMs}ms`);

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

    const resolvedImages = referenceImages.length
      ? useCodexBinary
        ? referenceImages
        : await ensureDataUrls(referenceImages)
      : [];

    let lastError: Error | null = null;

    for (const model of candidateModels) {
      const supportsSseFallback = isCodexImageModel(model);
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
        )}, output_format=${String(basePayload.output_format)}, references=${resolvedImages.length}, reference_source=${
          resolvedImages.length
            ? "dataurl"
            : "none"
        }, transport=${supportsSseFallback ? "json+sse-fallback" : "json"}`
      );

      const payload = resolvedImages.length
        ? resolvedImages.length === 1
          ? {
              ...basePayload,
              image: resolvedImages[0],
            }
          : isCodexImageModel(model)
            ? {
                ...basePayload,
                images: resolvedImages,
              }
            : {
                ...basePayload,
                image: resolvedImages,
              }
        : basePayload;

      let response = await executeRequest(payload);

      if (!response.ok && resolvedImages.length > 1 && response.status === 400) {
        const errorText = await response.text();
        console.warn(`[ImageGen] ${model} rejected multiple references, retrying with first input_image:`, errorText);
        response = await executeRequest({
          ...basePayload,
          image: resolvedImages[0],
        });
      }

      if (!response.ok && resolvedImages.length > 0 && response.status === 400) {
        const errorText = await response.text();
        console.warn(`[ImageGen] ${model} rejected reference image, retrying without image:`, errorText);
        response = await executeRequest(noReferencePayload);
      }

      console.log(`[ImageGen] Model ${model} response status: ${response.status}, ct: ${response.headers.get("content-type")}`);

      const maxParseRetries = isCodexImageModel(model) ? 5 : 1;
      let lastParseError: Error | null = null;

      for (let parseAttempt = 1; parseAttempt <= maxParseRetries; parseAttempt++) {
        if (parseAttempt > 1) {
          const delayMs = response?.status === 502 ? 5000 : 2000;
          console.log(`[ImageGen] Retrying request to ${model} (attempt ${parseAttempt}) after ${delayMs}ms...`);
          await new Promise((r) => setTimeout(r, delayMs));
          response = await executeRequest(payload);
          console.log(`[ImageGen] ${model} retry response status: ${response.status}`);
          if (!response.ok) {
            const errText = await response.text();
            lastParseError = new Error(`Retry failed: ${response.status} ${errText}`);
            continue;
          }
        }

        try {
          clearTimeout(timeoutId);

          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`API error ${response.status}: ${errBody.slice(0, 300)}`);
          }

          const ct = response.headers.get("content-type") || "";
          if (ct.includes("image/")) {
            const arrayBuf = await response.arrayBuffer();
            const b64 = Buffer.from(arrayBuf).toString("base64");
            console.log(`[ImageGen] ${model} binary response: ${arrayBuf.byteLength} bytes`);
            return {
              data: [{ b64_json: b64 }],
              _meta: { model, fallbackUsed: model !== requestedModel },
            };
          }

          if (useCodexBinary && ct.includes("application/json")) {
            const jsonBody = await response.json() as { success?: boolean; b64_json?: string; error?: string; size?: number };
            if (jsonBody.success && jsonBody.b64_json) {
              console.log(`[ImageGen] ${model} go-proxy response: ${jsonBody.size || 0} bytes`);
              return {
                data: [{ b64_json: jsonBody.b64_json }],
                _meta: { model, fallbackUsed: model !== requestedModel },
              };
            }
            if (jsonBody.error) {
              throw new Error(`Go proxy error: ${jsonBody.error}`);
            }
          }

          const result = await parseImageGenerationResponse(response);
          console.log(`[ImageGen] Success with ${model} (attempt ${parseAttempt}), got ${result?.data?.length || 0} images`);
          return {
            ...result,
            _meta: {
              model,
              fallbackUsed: model !== requestedModel,
            },
          };
        } catch (parseError) {
          lastParseError = parseError instanceof Error ? parseError : new Error("Failed to parse image response.");
          console.warn(`[ImageGen] ${model} parse attempt ${parseAttempt}/${maxParseRetries} failed: ${lastParseError.message}`);
        }
      }

      lastError = lastParseError || new Error("Image generation failed: all parse attempts exhausted");

      if (model !== candidateModels[candidateModels.length - 1]) {
        console.warn(`[ImageGen] ${model} failed after ${maxParseRetries} attempts, trying fallback model.`);
        continue;
      }

      throw lastError;
    }

    throw lastError || new Error("Image generation failed");
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`[ImageGen] Error:`, error);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Image generation timeout (>${Math.round(requestTimeoutMs / 1000)} detik)`);
    }
    throw error;
  }
}
