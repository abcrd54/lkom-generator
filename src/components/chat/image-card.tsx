"use client";

import { Button } from "@/components/ui/button";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

interface ImageCardProps {
  url: string;
  alt?: string;
  expiresAt?: string;
}

export function ImageCard({ url, alt = "Generated image", expiresAt }: ImageCardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [renderedAt] = useState(() => Date.now());

  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - renderedAt) / (1000 * 60 * 60 * 24)))
    : null;

  const handleDownload = async () => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `lkom-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch {
      window.open(url, "_blank");
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white max-w-sm">
      <div className="relative">
        {loading && (
          <div className="flex h-32 items-center justify-center bg-slate-50">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          </div>
        )}
        {error ? (
          <div className="flex h-32 items-center justify-center bg-red-50 text-xs text-red-500">
            Gagal memuat gambar
          </div>
        ) : (
          <Image
            src={url}
            alt={alt}
            width={384}
            height={192}
            unoptimized
            className={`w-full max-h-48 object-cover ${loading ? "hidden" : ""}`}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-100">
        <div className="flex items-center gap-2">
          {daysLeft !== null && (
            <span className={`text-[10px] ${daysLeft <= 2 ? "text-red-500 font-medium" : "text-slate-400"}`}>
              {daysLeft === 0 ? "Hari terakhir" : `${daysLeft} hari lagi`}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-slate-400 hover:text-slate-600"
            onClick={handleDownload}
            title="Download"
          >
            <Download className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-slate-400 hover:text-slate-600"
            onClick={() => window.open(url, "_blank")}
            title="Buka di tab baru"
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
