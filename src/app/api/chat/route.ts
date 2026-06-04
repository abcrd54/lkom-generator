import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { streamChat } from "@/lib/ai";
import { SYSTEM_PROMPT_TEXT } from "@/lib/prompts";
import { chatQueue } from "@/lib/queue";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { conversationId, message } = await request.json();

    if (!conversationId || !message) {
      return NextResponse.json({ error: "Missing conversationId or message" }, { status: 400 });
    }

    // Verify conversation belongs to user
    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Fetch recent messages for context (last 20)
    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(20);

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT_TEXT },
      ...(history || []).map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content || "",
      })),
    ];

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Use queue for the AI request
          const aiStream = await chatQueue.add(() => streamChat({ messages }));

          for await (const chunk of aiStream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              const data = JSON.stringify({
                choices: [{ delta: { content } }],
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          // Log usage (non-blocking)
          supabase.from("usage_logs").insert({
            user_id: user.id,
            type: "text",
            model: "cx/gpt-5.5",
            tokens: 0,
          }).then(() => null, () => null);
        } catch (error) {
          console.error("Stream error:", error);
          const errorMessage = error instanceof Error ? error.message : "Stream error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: errorMessage })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
