import process from "node:process";
import { generateImage } from "@/lib/ai";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sQnUn0AAAAASUVORK5CYII=";

async function main() {
  const originalPrompt =
    process.argv.slice(2).join(" ").trim() ||
    "Ubah bunga pada referensi menjadi ilustrasi sederhana untuk bahan ajar.";
  const finalPrompt = [
    originalPrompt,
    "Use the attached reference image as the main visual reference.",
    "Preserve the subject identity, key visual traits, composition cues, and important details from the reference image while following the user's request.",
    "Do not ignore the reference image.",
  ].join(" ");

  const result = await generateImage({
    prompt: finalPrompt,
    fallbackPromptWithoutReferences: originalPrompt,
    model: "cx/gpt-5.5-image",
    size: "auto",
    referenceImageDataUrls: [TINY_PNG_DATA_URL],
  });

  console.log(`USED_MODEL=${result?._meta?.model || "unknown"}`);
  console.log(`FALLBACK_USED=${String(Boolean(result?._meta?.fallbackUsed))}`);
  console.log(`HAS_IMAGE=${String(Boolean(result?.data?.[0]?.b64_json || result?.data?.[0]?.url))}`);
}

main().catch((error) => {
  console.error("TEST_FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
