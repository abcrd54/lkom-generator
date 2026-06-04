import { NextResponse } from "next/server";
import { chatQueue, imageQueue } from "@/lib/queue";

export async function GET() {
  return NextResponse.json({
    chat: chatQueue.stats,
    image: imageQueue.stats,
  });
}
