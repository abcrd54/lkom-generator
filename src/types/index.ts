export type UserRole = "user" | "admin";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  avatar_url: string | null;
  daily_image_limit: number;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  model: string;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface GeneratedImage {
  id: string;
  message_id: string | null;
  user_id: string;
  r2_url: string;
  prompt: string;
  style: ImageStyle;
  age_group: AgeGroup;
  aspect_ratio: AspectRatio;
  detail_level: DetailLevel;
  color_theme: string;
  language: ImageLanguage;
  watermark: string | null;
  model: string;
  expires_at: string;
  created_at: string;
}

export type ImageStyle = "cartoon" | "infographic" | "poster" | "diagram" | "character";
export type AgeGroup = "tk" | "sd" | "smp" | "sma";
export type AspectRatio = "3:4" | "1:1" | "16:9" | "9:16" | "4:3";
export type DetailLevel = "simple" | "medium" | "detailed";
export type ImageLanguage = "id" | "en" | "bilingual";

export interface ImageGenerateRequest {
  prompt: string;
  style: ImageStyle;
  ageGroup: AgeGroup;
  aspectRatio: AspectRatio;
  detailLevel: DetailLevel;
  colorTheme: string;
  language: ImageLanguage;
  watermark?: string;
  conversationId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  imageUrl?: string;
  imageMetadata?: GeneratedImage;
  createdAt: string;
}

export interface ImageQuota {
  used: number;
  remaining: number;
  resetAt: string;
}
