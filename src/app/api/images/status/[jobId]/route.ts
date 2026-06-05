import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getImageQueue } from "@/lib/image-jobs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const queue = getImageQueue();
    const job = await queue.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.data.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const state = await job.getState();

    if (state === "completed") {
      return NextResponse.json({
        jobId,
        status: "completed",
        result: job.returnvalue,
      });
    }

    if (state === "failed") {
      return NextResponse.json({
        jobId,
        status: "failed",
        error: job.failedReason || "Image generation failed",
      });
    }

    return NextResponse.json({
      jobId,
      status: state,
      progress: job.progress,
    });
  } catch (error) {
    console.error("Image job status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal mengambil status gambar" },
      { status: 500 }
    );
  }
}
