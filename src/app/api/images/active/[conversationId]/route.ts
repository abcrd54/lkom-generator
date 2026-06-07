import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getImageQueue } from "@/lib/image-jobs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { conversationId } = await params;
    const queue = getImageQueue();

    const jobs = await queue.getJobs(["waiting", "delayed", "active"]);
    const matchingJob = jobs.find(
      (job) => job.data.userId === user.id && job.data.conversationId === conversationId
    );

    if (!matchingJob) {
      return NextResponse.json({ hasPendingJob: false });
    }

    const state = await matchingJob.getState();

    return NextResponse.json({
      hasPendingJob: true,
      jobId: matchingJob.id,
      status: state,
    });
  } catch (error) {
    console.error("Active job check error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal cek job" },
      { status: 500 }
    );
  }
}
