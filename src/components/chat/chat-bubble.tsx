"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { User, GraduationCap, Copy, Check } from "lucide-react";
import { useState } from "react";
import { ImageCard } from "./image-card";
import type { ChatMessage } from "@/types";

interface ChatBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isPending?: boolean;
}

export function ChatBubble({ message, isStreaming, isPending }: ChatBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    if (message.content) {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const renderContent = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-semibold mt-3 mb-1">{line.slice(4)}</h3>;
      if (line.startsWith("## ")) return <h2 key={i} className="text-base font-semibold mt-3 mb-1">{line.slice(3)}</h2>;
      if (line.startsWith("# ")) return <h1 key={i} className="text-lg font-bold mt-3 mb-1">{line.slice(2)}</h1>;

      const boldProcessed = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      const codeProcessed = boldProcessed.replace(/`(.*?)`/g, '<code class="bg-blue-50 text-blue-800 px-1.5 py-0.5 rounded text-xs font-mono">$1</code>');

      if (line.match(/^[-*]\s/)) {
        return (
          <div key={i} className="flex gap-2 ml-2">
            <span className="text-blue-500 mt-0.5">•</span>
            <span dangerouslySetInnerHTML={{ __html: codeProcessed.slice(2) }} />
          </div>
        );
      }

      if (line.match(/^\d+\.\s/)) {
        const num = line.match(/^(\d+)\./)?.[1];
        return (
          <div key={i} className="flex gap-2 ml-2">
            <span className="text-blue-500 font-medium text-xs mt-0.5">{num}.</span>
            <span dangerouslySetInnerHTML={{ __html: codeProcessed.replace(/^\d+\.\s/, "") }} />
          </div>
        );
      }

      if (line.trim() === "") return <div key={i} className="h-2" />;

      return <p key={i} className="leading-relaxed" dangerouslySetInnerHTML={{ __html: codeProcessed }} />;
    });
  };

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {/* AI Avatar - left side */}
      {!isUser && (
        <Avatar className="h-8 w-8 shrink-0 mt-1">
          <AvatarFallback className="bg-blue-100 text-blue-700">
            <GraduationCap className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}

      {/* Bubble */}
      <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"} max-w-[85%]`}>
        <div
          className={`group relative text-sm ${
            isUser
              ? "bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-3"
              : "bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-sm shadow-sm px-5 py-4 w-full"
          }`}
        >
          {message.content && (
            <div className={isUser ? "text-white" : ""}>
              {isUser ? <p className="text-right">{message.content}</p> : renderContent(message.content)}
            </div>
          )}

          {isPending && !message.content && (
            <div className="space-y-3 min-w-[220px]">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <span className="inline-flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                AI sedang menyusun jawaban
              </div>
              <div className="space-y-2">
                <div className="h-2.5 w-40 rounded-full bg-slate-200/90 animate-pulse" />
                <div className="h-2.5 w-56 rounded-full bg-slate-200/80 animate-pulse [animation-delay:150ms]" />
                <div className="h-2.5 w-32 rounded-full bg-slate-200/70 animate-pulse [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {message.imageUrl && (
            <div className="mt-3">
              <ImageCard url={message.imageUrl} />
            </div>
          )}

          {/* Streaming indicator */}
          {isStreaming && (
            <span className="inline-flex gap-1 ml-1 mt-2">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: "200ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: "400ms" }} />
            </span>
          )}

          {/* Copy button */}
          {!isUser && message.content && !isStreaming && (
            <button
              onClick={handleCopy}
              className="absolute -right-2 -top-2 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-md border bg-white shadow-sm text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </button>
          )}
        </div>

        {message.model && !isUser && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-200 text-slate-400 ml-1">
            {message.model}
          </Badge>
        )}
      </div>

      {/* User Avatar - right side */}
      {isUser && (
        <Avatar className="h-8 w-8 shrink-0 mt-1">
          <AvatarFallback className="bg-blue-600 text-white">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
