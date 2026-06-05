ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS reference_images JSONB;
