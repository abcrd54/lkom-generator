-- LKOM Generator - Supabase Schema
-- Jalankan di Supabase Dashboard > SQL Editor
-- Safe to run multiple times (IF NOT EXISTS)

-- 1. Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  avatar_url TEXT,
  daily_image_limit INT DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- 2. Conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT DEFAULT 'Chat Baru',
  model TEXT NOT NULL DEFAULT 'gpt-5.5',
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Messages
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT,
  model TEXT,
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Images
CREATE TABLE IF NOT EXISTS public.images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  r2_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  style TEXT CHECK (style IN ('cartoon', 'infographic', 'poster', 'diagram', 'character')),
  age_group TEXT CHECK (age_group IN ('tk', 'sd', 'smp', 'sma')),
  aspect_ratio TEXT CHECK (aspect_ratio IN ('3:4', '1:1', '16:9', '9:16', '4:3')),
  detail_level TEXT CHECK (detail_level IN ('simple', 'medium', 'detailed')),
  color_theme TEXT DEFAULT 'blue',
  language TEXT CHECK (language IN ('id', 'en', 'bilingual')) DEFAULT 'id',
  watermark TEXT,
  model TEXT DEFAULT 'cx/gpt-5.5-image',
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Usage logs
CREATE TABLE IF NOT EXISTS public.usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'image')),
  model TEXT NOT NULL,
  tokens INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes (CREATE INDEX IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_conversations_user ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_latest ON public.conversations(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_images_user ON public.images(user_id);
CREATE INDEX IF NOT EXISTS idx_images_expires ON public.images(expires_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_date ON public.usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_type ON public.usage_logs(type);

-- Update last_message_at on new message
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_new_message'
  ) THEN
    CREATE TRIGGER on_new_message
      AFTER INSERT ON public.messages
      FOR EACH ROW EXECUTE FUNCTION update_conversation_timestamp();
  END IF;
END $$;

-- RLS Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

-- Helper: create policy only if not exists
DO $$
BEGIN
  -- Profiles policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own profile' AND tablename = 'profiles') THEN
    CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own profile' AND tablename = 'profiles') THEN
    CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin can view all profiles' AND tablename = 'profiles') THEN
    CREATE POLICY "Admin can view all profiles" ON public.profiles FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin can update all profiles' AND tablename = 'profiles') THEN
    CREATE POLICY "Admin can update all profiles" ON public.profiles FOR UPDATE USING (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );
  END IF;

  -- Conversations policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can CRUD own conversations' AND tablename = 'conversations') THEN
    CREATE POLICY "Users can CRUD own conversations" ON public.conversations FOR ALL USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin can view all conversations' AND tablename = 'conversations') THEN
    CREATE POLICY "Admin can view all conversations" ON public.conversations FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );
  END IF;

  -- Messages policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can access own messages' AND tablename = 'messages') THEN
    CREATE POLICY "Users can access own messages" ON public.messages FOR ALL USING (
      EXISTS (
        SELECT 1 FROM public.conversations
        WHERE conversations.id = messages.conversation_id
        AND conversations.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin can view all messages' AND tablename = 'messages') THEN
    CREATE POLICY "Admin can view all messages" ON public.messages FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );
  END IF;

  -- Images policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can CRUD own images' AND tablename = 'images') THEN
    CREATE POLICY "Users can CRUD own images" ON public.images FOR ALL USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin can view all images' AND tablename = 'images') THEN
    CREATE POLICY "Admin can view all images" ON public.images FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );
  END IF;

  -- Usage logs policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own usage' AND tablename = 'usage_logs') THEN
    CREATE POLICY "Users can view own usage" ON public.usage_logs FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'System can insert usage' AND tablename = 'usage_logs') THEN
    CREATE POLICY "System can insert usage" ON public.usage_logs FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin can view all usage' AND tablename = 'usage_logs') THEN
    CREATE POLICY "Admin can view all usage" ON public.usage_logs FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );
  END IF;
END $$;

-- Function: get image quota
CREATE OR REPLACE FUNCTION get_image_quota(p_user_id UUID)
RETURNS TABLE(used INT, remaining INT, reset_at TIMESTAMPTZ) AS $$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_used INT;
  v_limit INT;
BEGIN
  v_today_start := DATE_TRUNC('day', NOW());

  SELECT COALESCE(daily_image_limit, 15) INTO v_limit
  FROM profiles WHERE id = p_user_id;

  SELECT COUNT(*)::INT INTO v_used
  FROM usage_logs
  WHERE user_id = p_user_id
    AND type = 'image'
    AND created_at >= v_today_start;

  RETURN QUERY SELECT
    v_used,
    GREATEST(0, v_limit - v_used),
    v_today_start + INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-cleanup expired images
CREATE OR REPLACE FUNCTION cleanup_expired_images()
RETURNS void AS $$
BEGIN
  DELETE FROM public.images WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
