import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function getGoProxyBaseUrl() {
  return (process.env.GO_PROXY_URL || "http://localhost:20129").replace(/\/+$/, "");
}

function isSafeFileName(file: string) {
  return /^[A-Za-z0-9._-]+$/.test(file);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const file = request.nextUrl.searchParams.get("file");
    if (!file || !isSafeFileName(file)) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }

    const upstream = await fetch(`${getGoProxyBaseUrl()}/files/${encodeURIComponent(file)}`, {
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: "Image not found" }, { status: upstream.status });
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "image/png");
    headers.set("Cache-Control", "private, max-age=300");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Image proxy error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal memuat gambar" },
      { status: 500 }
    );
  }
}
