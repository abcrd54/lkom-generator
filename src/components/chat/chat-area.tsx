"use client";

import { useEffect, useRef, useState } from "react";
import { ChatBubble } from "./chat-bubble";
import { GraduationCap, FileText, Image as ImageIcon, BarChart3, GitBranch, Clock } from "lucide-react";
import type { ChatMessage } from "@/types";

interface ChatAreaProps {
  messages: ChatMessage[];
  loading: boolean;
  streamingContent: string;
  pendingText?: string;
}

function ElapsedTimer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const isLong = seconds > 30;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${isLong ? "text-amber-600 font-medium" : "text-slate-400"}`}>
      <Clock className="h-3 w-3" />
      {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
      {isLong && " - Sedang diproses, mohon tunggu..."}
    </span>
  );
}

export function ChatArea({
  messages,
  loading,
  streamingContent,
  pendingText = "AI sedang menyusun jawaban",
}: ChatAreaProps) {
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
          <div className="flex justify-start">
            <div className="flex items-start gap-3 max-w-[85%]">
              <div className="h-8 w-8 shrink-0 rounded-full bg-blue-100 flex items-center justify-center mt-1">
                <GraduationCap className="h-4 w-4 text-blue-700" />
              </div>
              <div className="bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-sm shadow-sm px-5 py-4">
                <div className="space-y-3 min-w-[220px]">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <span className="inline-flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                    {pendingText}
                  </div>
                  <ElapsedTimer />
                  <div className="space-y-2">
                    <div className="h-2.5 w-40 rounded-full bg-slate-200/90 animate-pulse" />
                    <div className="h-2.5 w-56 rounded-full bg-slate-200/80 animate-pulse [animation-delay:150ms]" />
                    <div className="h-2.5 w-32 rounded-full bg-slate-200/70 animate-pulse [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
