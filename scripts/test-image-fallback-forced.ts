import process from "node:process";
import { generateImage } from "@/lib/ai";

async function main() {
  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "sebuah lingkaran hijau sederhana di atas latar putih";

  const originalFetch = globalThis.fetch;
  let injectedFailure = false;

  globalThis.fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const isPrimaryModelRequest = body?.model === "cx/gpt-5.5-image";

    if (!injectedFailure && isPrimaryModelRequest) {
      injectedFailure = true;
      console.log("[ForcedTest] Injecting synthetic 502 for cx/gpt-5.5-image");
      return new Response(
        JSON.stringify({
          error: {
            message:
              "[codex/gpt-5.5-image] Codex did not return an image. Account may not be entitled (Plus/Pro required). (reset after 25s)",
          },
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return originalFetch(input, init);
  };

  try {
    const result = await generateImage({
      prompt,
      model: "cx/gpt-5.5-image",
      size: "1024x1024",
    });

    console.log(`USED_MODEL=${result?._meta?.model || "unknown"}`);
    console.log(`FALLBACK_USED=${String(Boolean(result?._meta?.fallbackUsed))}`);
    console.log(`HAS_IMAGE=${String(Boolean(result?.data?.[0]?.b64_json || result?.data?.[0]?.url))}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error("TEST_FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
