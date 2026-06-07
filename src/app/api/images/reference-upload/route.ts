import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_REFERENCE_IMAGES = 3;
const MAX_REFERENCE_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_REFERENCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
    default:
      return "jpg";
  }
}

async function uploadToGoProxy(buffer: Buffer, extension: string): Promise<string> {
  const goProxyUrl = process.env.GO_PROXY_URL || "http://localhost:20129";
  const b64 = buffer.toString("base64");

  const res = await fetch(`${goProxyUrl}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: b64, extension }),
  });

  if (!res.ok) {
    throw new Error(`Go proxy upload failed: ${res.status}`);
  }

  const json = (await res.json()) as { url?: string };
  if (!json.url) {
    throw new Error("Go proxy upload returned no URL");
  }

  return json.url;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "File referensi wajib diisi" }, { status: 400 });
    }

    if (files.length > MAX_REFERENCE_IMAGES) {
      return NextResponse.json({ error: "Maksimal 3 gambar referensi" }, { status: 400 });
    }

    const invalidFile = files.find(
      (file) => !ALLOWED_REFERENCE_TYPES.has(file.type) || file.size > MAX_REFERENCE_FILE_SIZE
    );

    if (invalidFile) {
      if (!ALLOWED_REFERENCE_TYPES.has(invalidFile.type)) {
        return NextResponse.json({ error: "Format gambar harus JPG, PNG, atau WEBP" }, { status: 400 });
      }

      return NextResponse.json({ error: "Ukuran gambar maksimal 5 MB" }, { status: 400 });
    }

    const uploadedFiles = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        const extension = extensionForMimeType(file.type);
        const url = await uploadToGoProxy(buffer, extension);

        return {
          name: file.name,
          mimeType: file.type,
          url,
        };
      })
    );

    return NextResponse.json({ files: uploadedFiles });
  } catch (error) {
    console.error("Reference upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal upload gambar referensi" },
      { status: 500 }
    );
  }
}
