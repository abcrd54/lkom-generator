"use client";
/* eslint-disable @next/next/no-img-element */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { getChatImageUrl } from "@/lib/image-url";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

interface ImageCardProps {
  url: string;
  alt?: string;
  expiresAt?: string;
}

export function ImageCard({ url, alt = "Generated image", expiresAt }: ImageCardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [renderedAt] = useState(() => Date.now());
  const resolvedUrl = getChatImageUrl(url);

  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - renderedAt) / (1000 * 60 * 60 * 24)))
    : null;

  const handleDownload = async () => {
    try {
      const response = await fetch(resolvedUrl);
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
      window.open(resolvedUrl, "_blank");
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white max-w-sm">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              className="relative block w-full overflow-hidden bg-slate-50 text-left"
              disabled={error}
            />
          }
        >
          {loading && (
            <div className="absolute inset-0 z-10 flex h-full min-h-32 items-center justify-center bg-slate-50/90">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            </div>
          )}
          {error ? (
            <div className="flex h-32 items-center justify-center bg-red-50 text-xs text-red-500">
              Gagal memuat gambar
            </div>
          ) : (
            <img
              key={resolvedUrl}
              src={resolvedUrl}
              alt={alt}
              className="block w-full max-h-48 object-cover"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(true);
              }}
            />
          )}
        </DialogTrigger>
        <DialogContent className="max-w-5xl border-none bg-black/95 p-2 text-white shadow-2xl sm:max-w-[min(92vw,1200px)]" showCloseButton={true}>
          <div className="flex max-h-[88vh] items-center justify-center overflow-hidden rounded-lg">
            <img
              key={`${resolvedUrl}-modal`}
              src={resolvedUrl}
              alt={alt}
              className="max-h-[88vh] w-auto max-w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-100">
        <div className="flex items-center gap-2">
          {daysLeft !== null && (
            <span className={`text-[10px] ${daysLeft <= 2 ? "text-red-500 font-medium" : "text-slate-400"}`}>
              {daysLeft === 0 ? "Hari terakhir" : `${daysLeft} hari lagi`}
            </span>
          )}
          {!error && (
            <span className="text-[10px] text-slate-400">
              Klik gambar untuk memperbesar
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
        </div>
      </div>
    </div>
  );
}
