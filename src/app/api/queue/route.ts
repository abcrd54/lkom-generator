import { NextResponse } from "next/server";
import { chatQueue } from "@/lib/queue";
import { getImageQueue } from "@/lib/image-jobs";

export async function GET() {
  const imageQueue = getImageQueue();
  const imageCounts = await imageQueue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
    "paused"
  );

  return NextResponse.json({
    chat: chatQueue.stats,
    image: imageCounts,
  });
}
