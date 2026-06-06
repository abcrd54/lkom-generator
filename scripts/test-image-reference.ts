import process from "node:process";
import { generateImage } from "@/lib/ai";

async function main() {
  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "Buat ulang objek utama dari gambar referensi menjadi ilustrasi sederhana untuk bahan ajar.";

  const result = await generateImage({
    prompt,
    model: "cx/gpt-5.5-image",
    size: "auto",
    referenceImageUrls: [
      "https://upload.wikimedia.org/wikipedia/commons/3/3f/JPEG_example_flower.jpg",
    ],
  });

  console.log(`USED_MODEL=${result?._meta?.model || "unknown"}`);
  console.log(`FALLBACK_USED=${String(Boolean(result?._meta?.fallbackUsed))}`);
  console.log(`HAS_IMAGE=${String(Boolean(result?.data?.[0]?.b64_json || result?.data?.[0]?.url))}`);
}

main().catch((error) => {
  console.error("TEST_FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
