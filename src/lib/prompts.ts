import type { ImageStyle, AgeGroup, AspectRatio, DetailLevel, ImageLanguage } from "@/types";

export const IMAGE_STYLES: Record<ImageStyle, { label: string; icon: string; prefix: string }> = {
  cartoon: {
    label: "Kartun",
    icon: "brush",
    prefix: "Create a colorful cartoon illustration, cheerful, child-friendly art style:",
  },
  infographic: {
    label: "Infografis",
    icon: "bar-chart",
    prefix: "Create a clean educational infographic with icons, data visualization, and organized layout:",
  },
  poster: {
    label: "Poster Edukasi",
    icon: "file-text",
    prefix: "Create an educational poster with bold headline, illustrations, and clear information hierarchy:",
  },
  diagram: {
    label: "Diagram/Skema",
    icon: "git-branch",
    prefix: "Create a clear educational diagram with labeled parts, arrows, and organized structure:",
  },
  character: {
    label: "Karakter Kartun",
    icon: "user",
    prefix: "Create a cute cartoon character, friendly persona, full body, clean background:",
  },
};

export const AGE_GROUPS: Record<AgeGroup, { label: string; suffix: string }> = {
  tk: {
    label: "TK/PAUD",
    suffix: "Very simple, very colorful, big cute characters, minimal text, large shapes, for ages 3-6.",
  },
  sd: {
    label: "SD",
    suffix: "Colorful and fun, cartoon style, clear illustrations, easy to understand, for ages 6-12.",
  },
  smp: {
    label: "SMP",
    suffix: "More detailed, clean infographic style, moderate complexity, for ages 12-15.",
  },
  sma: {
    label: "SMA",
    suffix: "Professional, clean design, data-driven, charts and graphs where appropriate, for ages 15-18.",
  },
};

export const DETAIL_LEVELS: Record<DetailLevel, { label: string; suffix: string }> = {
  simple: {
    label: "Sederhana",
    suffix: "Minimalist, simple shapes, few elements, clean white space.",
  },
  medium: {
    label: "Sedang",
    suffix: "Balanced detail, clear layout, moderate elements.",
  },
  detailed: {
    label: "Detail",
    suffix: "Rich detail, comprehensive elements, thorough illustration.",
  },
};

export const COLOR_THEMES: Record<string, { label: string; hex: string; suffix: string }> = {
  blue: { label: "Biru", hex: "#2563EB", suffix: "Use blue as dominant color theme." },
  red: { label: "Merah", hex: "#DC2626", suffix: "Use red as dominant color theme." },
  green: { label: "Hijau", hex: "#16A34A", suffix: "Use green as dominant color theme." },
  yellow: { label: "Kuning", hex: "#CA8A04", suffix: "Use yellow as dominant color theme." },
  purple: { label: "Ungu", hex: "#9333EA", suffix: "Use purple as dominant color theme." },
  orange: { label: "Oranye", hex: "#EA580C", suffix: "Use orange as dominant color theme." },
  custom: { label: "Custom", hex: "", suffix: "" },
};

export const ASPECT_RATIOS: Record<AspectRatio, { label: string; width: number; height: number; icon: string }> = {
  "3:4": { label: "Poster (3:4)", width: 768, height: 1024, icon: "portrait" },
  "1:1": { label: "Kotak (1:1)", width: 1024, height: 1024, icon: "square" },
  "16:9": { label: "Presentasi (16:9)", width: 1344, height: 768, icon: "wide" },
  "9:16": { label: "Infografis (9:16)", width: 576, height: 1024, icon: "tall" },
  "4:3": { label: "Worksheet (4:3)", width: 1024, height: 768, icon: "classic" },
};

export const LANGUAGES: Record<ImageLanguage, { label: string; suffix: string }> = {
  id: { label: "Indonesia", suffix: "All text in the image must be in Indonesian (Bahasa Indonesia)." },
  en: { label: "English", suffix: "All text in the image must be in English." },
  bilingual: { label: "Bilingual", suffix: "Include text in both Indonesian and English." },
};

export const SYSTEM_PROMPT_TEXT = `Kamu adalah AI assistant yang membantu pengguna dengan berbagai kebutuhan.
Jawab dengan Bahasa Indonesia yang baik dan benar. Gunakan bahasa yang profesional dan mudah dipahami.
Gunakan format markdown untuk memformat jawaban: heading, bold, list, code block, dll agar mudah dibaca.`;

export function buildImagePrompt(options: {
  userPrompt: string;
  style: ImageStyle;
  ageGroup: AgeGroup;
  detailLevel: DetailLevel;
  colorTheme: string;
  customColor?: string;
  language: ImageLanguage;
  watermark?: string;
  hasReferenceImage?: boolean;
}): string {
  const parts: string[] = [];

  parts.push(IMAGE_STYLES[options.style].prefix);
  parts.push(options.userPrompt);
  parts.push(AGE_GROUPS[options.ageGroup].suffix);
  parts.push(DETAIL_LEVELS[options.detailLevel].suffix);

  if (options.colorTheme === "custom" && options.customColor) {
    parts.push(`Use ${options.customColor} as the dominant color theme.`);
  } else if (options.colorTheme !== "custom" && COLOR_THEMES[options.colorTheme]) {
    parts.push(COLOR_THEMES[options.colorTheme].suffix);
  }

  parts.push(LANGUAGES[options.language].suffix);

  if (options.watermark) {
    parts.push(`Include a small watermark text "${options.watermark}" in the bottom corner, semi-transparent.`);
  }

  if (options.hasReferenceImage) {
    parts.push("Use the attached reference image as a strong visual reference for subject identity, composition cues, silhouette, pose, and key visual elements while still following the requested educational style.");
    parts.push("Do not copy the reference photo literally; transform it cleanly into the requested illustration style.");
  }

  return parts.join(" ");
}
