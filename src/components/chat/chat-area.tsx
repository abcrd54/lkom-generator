"use client";

import { useEffect, useRef } from "react";
import { ChatBubble } from "./chat-bubble";
import { GraduationCap, FileText, Image as ImageIcon, BarChart3, GitBranch } from "lucide-react";
import type { ChatMessage } from "@/types";

interface ChatAreaProps {
  messages: ChatMessage[];
  loading: boolean;
  streamingContent: string;
}

export function ChatArea({ messages, loading, streamingContent }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-blue-100">
          <GraduationCap className="h-8 w-8 text-blue-600" />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-slate-900">
          Selamat Datang!
        </h2>
        <p className="mb-8 max-w-md text-sm text-slate-500">
          Saya siap membantu Anda dengan berbagai kebutuhan. Silakan mulai percakapan.
        </p>
        <div className="grid max-w-lg grid-cols-2 gap-3 text-left">
          {[
            { icon: <FileText className="h-5 w-5 text-blue-600" />, title: "Buat Dokumen", desc: "Artikel, laporan, surat, dan dokumen lainnya" },
            { icon: <ImageIcon className="h-5 w-5 text-blue-600" />, title: "Buat Gambar", desc: "Poster, ilustrasi, infografis" },
            { icon: <BarChart3 className="h-5 w-5 text-blue-600" />, title: "Analisis Data", desc: "Ringkasan, grafik, insight dari data" },
            { icon: <GitBranch className="h-5 w-5 text-blue-600" />, title: "Jelaskan Konsep", desc: "Penjelasan topik kompleks dengan sederhana" },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-default"
            >
              <div className="mb-2">{item.icon}</div>
              <div className="text-sm font-medium text-slate-900">{item.title}</div>
              <div className="text-xs text-slate-500">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-6">
      <div className="space-y-6 px-4">
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming message with pulse animation */}
        {streamingContent && (
          <ChatBubble
            message={{
              id: "streaming",
              role: "assistant",
              content: streamingContent,
              createdAt: new Date().toISOString(),
            }}
            isStreaming={true}
          />
        )}

        {/* Pending AI bubble before stream starts */}
        {loading && !streamingContent && (
          <ChatBubble
            message={{
              id: "pending",
              role: "assistant",
              content: "",
              createdAt: new Date().toISOString(),
            }}
            isPending={true}
          />
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
