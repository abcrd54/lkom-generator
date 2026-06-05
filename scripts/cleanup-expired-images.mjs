import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const BATCH_SIZE = Number.parseInt(process.env.EXPIRED_IMAGE_CLEANUP_BATCH_SIZE || "100", 10);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

function extractObjectKey(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return null;
  }
}

async function main() {
  const nowIso = new Date().toISOString();
  const { data: expiredImages, error } = await supabase
    .from("images")
    .select("id, r2_url, expires_at, storage_deleted_at")
    .lte("expires_at", nowIso)
    .is("storage_deleted_at", null)
    .not("r2_url", "is", null)
    .limit(BATCH_SIZE);

  if (error) {
    throw new Error(`Failed to query expired images: ${error.message}`);
  }

  if (!expiredImages?.length) {
    console.log("[cleanup] no expired images to process");
    return;
  }

  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const image of expiredImages) {
    const key = extractObjectKey(image.r2_url);
    if (!key) {
      skipped += 1;
      console.warn(`[cleanup] skipped image ${image.id}: invalid R2 URL`);
      continue;
    }

    try {
      await r2Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
        })
      );

      const { error: updateError } = await supabase
        .from("images")
        .update({
          r2_url: null,
          storage_deleted_at: new Date().toISOString(),
        })
        .eq("id", image.id);

      if (updateError) {
        failed += 1;
        console.error(`[cleanup] deleted object but failed to update DB for ${image.id}: ${updateError.message}`);
        continue;
      }

      deleted += 1;
      console.log(`[cleanup] deleted expired image ${image.id}`);
    } catch (cleanupError) {
      failed += 1;
      console.error(
        `[cleanup] failed to delete expired image ${image.id}:`,
        cleanupError instanceof Error ? cleanupError.message : cleanupError
      );
    }
  }

  console.log(`[cleanup] done. deleted=${deleted} skipped=${skipped} failed=${failed}`);
}

main().catch((error) => {
  console.error("[cleanup] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
