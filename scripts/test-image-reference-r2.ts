import { uploadToR2 } from "@/lib/r2";
import { generateImage } from "@/lib/ai";

async function main() {
  const sourceUrl =
    "https://upload.wikimedia.org/wikipedia/commons/3/3f/JPEG_example_flower.jpg";
  const prompt = "Tambahkan matahari ke gambar referensi ini.";

  const sourceResponse = await fetch(sourceUrl);
  if (!sourceResponse.ok) {
    throw new Error(`Failed to fetch source image: ${sourceResponse.status}`);
  }

  const buffer = Buffer.from(await sourceResponse.arrayBuffer());
  const contentType = sourceResponse.headers.get("content-type") || "image/jpeg";
  const uploadedUrl = await uploadToR2({
    key: `references/manual-test-${Date.now()}.jpg`,
    body: buffer,
    contentType,
  });

  console.log(`UPLOADED_URL=${uploadedUrl}`);

  const headCheck = await fetch(uploadedUrl, { method: "HEAD" });
  console.log(`R2_HEAD_STATUS=${headCheck.status}`);
  console.log(`R2_HEAD_TYPE=${headCheck.headers.get("content-type") || "unknown"}`);

  const result = await generateImage({
    prompt,
    model: "cx/gpt-5.5-image",
    size: "auto",
    referenceImageUrls: [uploadedUrl],
  });

  console.log(`USED_MODEL=${result?._meta?.model || "unknown"}`);
  console.log(`FALLBACK_USED=${String(Boolean(result?._meta?.fallbackUsed))}`);
  console.log(`HAS_IMAGE=${String(Boolean(result?.data?.[0]?.b64_json || result?.data?.[0]?.url))}`);
}

main().catch((error) => {
  console.error("TEST_FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
