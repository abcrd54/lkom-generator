"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { Send, ImageIcon, Loader2, Settings2, X, Brush, BarChart3, FileText, GitBranch, User, Upload, ImagePlus } from "lucide-react";
import type { ImageStyle, AgeGroup, AspectRatio, DetailLevel, ImageLanguage } from "@/types";
import { IMAGE_STYLES, AGE_GROUPS, ASPECT_RATIOS, DETAIL_LEVELS, LANGUAGES, COLOR_THEMES } from "@/lib/prompts";

const STYLE_ICONS: Record<string, React.ReactNode> = {
  cartoon: <Brush className="h-3.5 w-3.5" />,
  infographic: <BarChart3 className="h-3.5 w-3.5" />,
  poster: <FileText className="h-3.5 w-3.5" />,
  diagram: <GitBranch className="h-3.5 w-3.5" />,
  character: <User className="h-3.5 w-3.5" />,
};

async function fileToReferencePayload(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load reference image"));
      img.src = objectUrl;
    });

    const maxDimension = 1024;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is unavailable");
    }

    context.drawImage(image, 0, 0, width, height);
    const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const quality = mimeType === "image/png" ? undefined : 0.86;
    const dataUrl = canvas.toDataURL(mimeType, quality);

    return {
      dataUrl,
      mimeType,
      name: file.name,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onGenerateImage: (options: {
    prompt: string;
    style: ImageStyle;
    ageGroup: AgeGroup;
    aspectRatio: AspectRatio;
    detailLevel: DetailLevel;
    colorTheme: string;
    language: ImageLanguage;
    watermark?: string;
    referenceImage?: {
      dataUrl: string;
      mimeType: string;
      name: string;
    };
  }) => void;
  loading: boolean;
  imageQuota: { remaining: number; limit?: number; resetAt: string } | null;
  disabled?: boolean;
}

export function ChatInput({ onSendMessage, onGenerateImage, loading, imageQuota, disabled }: ChatInputProps) {
  const [mode, setMode] = useState<"text" | "image">("text");
  const [message, setMessage] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [imageOptions, setImageOptions] = useState({
    style: "cartoon" as ImageStyle,
    ageGroup: "sd" as AgeGroup,
    aspectRatio: "1:1" as AspectRatio,
    detailLevel: "medium" as DetailLevel,
    colorTheme: "blue",
    language: "id" as ImageLanguage,
    watermark: "",
  });
  const [referenceImage, setReferenceImage] = useState<{
    dataUrl: string;
    mimeType: string;
    name: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [message]);

  const handleSubmit = () => {
    if (!message.trim() || loading) return;

    if (mode === "text") {
      onSendMessage(message.trim());
    } else {
      onGenerateImage({
        prompt: message.trim(),
        ...imageOptions,
        referenceImage: referenceImage || undefined,
      });
      setReferenceImage(null);
    }
    setMessage("");
  };

  const handleReferenceChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) return;

    const payload = await fileToReferencePayload(file);
    setReferenceImage(payload);

    event.target.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-slate-200 bg-white">
      {/* Image Options Panel */}
      {mode === "image" && showOptions && (
        <div className="border-b border-slate-100 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Opsi Gambar</span>
            <button onClick={() => setShowOptions(false)} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Style */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">Gaya</Label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(IMAGE_STYLES) as [ImageStyle, typeof IMAGE_STYLES[ImageStyle]][]).map(
                ([key, val]) => (
                  <button
                    key={key}
                    onClick={() => setImageOptions({ ...imageOptions, style: key })}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                      imageOptions.style === key
                        ? "bg-blue-600 text-white"
                        : "bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {STYLE_ICONS[key]}
                    {val.label}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Target + Rasio + Detail + Bahasa */}
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Target</Label>
              <div className="relative">
                <select
                  value={imageOptions.ageGroup}
                  onChange={(e) => setImageOptions({ ...imageOptions, ageGroup: e.target.value as AgeGroup })}
                  className="w-full appearance-none rounded-md border border-slate-200 bg-white px-2 py-1.5 pr-6 text-xs focus:border-blue-500 focus:outline-none"
                >
                  {(Object.entries(AGE_GROUPS) as [AgeGroup, typeof AGE_GROUPS[AgeGroup]][]).map(
                    ([key, val]) => (<option key={key} value={key}>{val.label}</option>)
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5">
                  <svg className="h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Rasio</Label>
              <div className="relative">
                <select
                  value={imageOptions.aspectRatio}
                  onChange={(e) => setImageOptions({ ...imageOptions, aspectRatio: e.target.value as AspectRatio })}
                  className="w-full appearance-none rounded-md border border-slate-200 bg-white px-2 py-1.5 pr-6 text-xs focus:border-blue-500 focus:outline-none"
                >
                  {(Object.entries(ASPECT_RATIOS) as [AspectRatio, typeof ASPECT_RATIOS[AspectRatio]][]).map(
                    ([key, val]) => (<option key={key} value={key}>{val.label}</option>)
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5">
                  <svg className="h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Detail</Label>
              <div className="relative">
                <select
                  value={imageOptions.detailLevel}
                  onChange={(e) => setImageOptions({ ...imageOptions, detailLevel: e.target.value as DetailLevel })}
                  className="w-full appearance-none rounded-md border border-slate-200 bg-white px-2 py-1.5 pr-6 text-xs focus:border-blue-500 focus:outline-none"
                >
                  {(Object.entries(DETAIL_LEVELS) as [DetailLevel, typeof DETAIL_LEVELS[DetailLevel]][]).map(
                    ([key, val]) => (<option key={key} value={key}>{val.label}</option>)
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5">
                  <svg className="h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Bahasa</Label>
              <div className="relative">
                <select
                  value={imageOptions.language}
                  onChange={(e) => setImageOptions({ ...imageOptions, language: e.target.value as ImageLanguage })}
                  className="w-full appearance-none rounded-md border border-slate-200 bg-white px-2 py-1.5 pr-6 text-xs focus:border-blue-500 focus:outline-none"
                >
                  {(Object.entries(LANGUAGES) as [ImageLanguage, typeof LANGUAGES[ImageLanguage]][]).map(
                    ([key, val]) => (<option key={key} value={key}>{val.label}</option>)
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5">
                  <svg className="h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Warna + Watermark */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Warna Tema</Label>
              <div className="flex gap-1.5 flex-wrap">
                {Object.entries(COLOR_THEMES)
                  .filter(([key]) => key !== "custom")
                  .map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => setImageOptions({ ...imageOptions, colorTheme: key })}
                      className={`h-7 w-7 rounded-md border-2 transition-all ${
                        imageOptions.colorTheme === key
                          ? "border-blue-600 scale-105"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                      style={{ backgroundColor: val.hex }}
                      title={val.label}
                    />
                  ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Watermark</Label>
              <input
                value={imageOptions.watermark}
                onChange={(e) => setImageOptions({ ...imageOptions, watermark: e.target.value })}
                placeholder="Opsional"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-slate-600">Gambar Referensi</Label>
              <button
                type="button"
                onClick={() => referenceInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                Tambah
              </button>
            </div>

            <input
              ref={referenceInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleReferenceChange}
            />

            {referenceImage ? (
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="relative h-14 w-14 overflow-hidden rounded-md border border-slate-200 bg-white">
                  <Image
                    src={referenceImage.dataUrl}
                    alt={referenceImage.name}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-slate-700">{referenceImage.name}</div>
                  <div className="text-[11px] text-slate-500">
                    Dipakai sebagai acuan visual untuk bentuk, pose, atau elemen utama.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReferenceImage(null)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => referenceInputRef.current?.click()}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-left hover:border-blue-300 hover:bg-blue-50/50"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-500 shadow-sm">
                  <Upload className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-700">Unggah 1 gambar referensi</div>
                  <div className="text-[11px] text-slate-500">JPG, PNG, WEBP. Maksimal 5 MB.</div>
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4">
        {/* Mode Tabs */}
        <div className="flex items-center gap-1 mb-3">
          <button
            onClick={() => setMode("text")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              mode === "text"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Send className="h-3 w-3" />
            Chat
          </button>
          <button
            onClick={() => setMode("image")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              mode === "image"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <ImageIcon className="h-3 w-3" />
            Gambar
          </button>

          {mode === "image" && (
            <button
              onClick={() => setShowOptions(!showOptions)}
              className={`ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-all ${
                showOptions
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <Settings2 className="h-3 w-3" />
              Opsi
            </button>
          )}

          {mode === "image" && imageQuota && (
            <span className="text-[10px] text-slate-400 ml-2">
              Sisa: <span className={imageQuota.remaining <= 3 ? "text-red-500 font-medium" : "text-blue-600 font-medium"}>{imageQuota.remaining}</span>/{imageQuota.limit ?? 15}
            </span>
          )}
        </div>

        {/* Textarea + Send */}
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "text"
                ? "Ketik pesan Anda..."
                : "Deskripsikan gambar yang ingin dibuat..."
            }
            className="min-h-[44px] max-h-[160px] resize-none border-slate-200 focus:border-blue-500 focus:ring-blue-500 text-sm"
            disabled={disabled}
            rows={1}
          />
          <Button
            onClick={handleSubmit}
            disabled={!message.trim() || loading || disabled}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 self-end h-11 w-11"
            size="icon"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === "image" ? (
              <ImageIcon className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
