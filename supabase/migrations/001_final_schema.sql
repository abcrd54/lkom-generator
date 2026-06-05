-- LKOM Generator - Final Schema (Simple RLS + Super Admin)
-- Jalankan di Supabase Dashboard > SQL Editor

-- ============================================
-- STEP 1: DROP semua
-- ============================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_new_message ON public.messages;

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.update_conversation_timestamp() CASCADE;
DROP FUNCTION IF EXISTS public.get_image_quota(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_expired_images() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.ensure_profile() CASCADE;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.usage_logs CASCADE;
DROP TABLE IF EXISTS public.images CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ============================================
-- STEP 2: CREATE tables
-- ============================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  avatar_url TEXT,
  daily_image_limit INT DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT DEFAULT 'Chat Baru',
  model TEXT NOT NULL DEFAULT 'gpt-5.5',
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT,
  model TEXT,
  image_url TEXT,
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.images (
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

CREATE TABLE public.usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'image')),
  model TEXT NOT NULL,
  tokens INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_conversations_user ON public.conversations(user_id);
CREATE INDEX idx_conversations_user_latest ON public.conversations(user_id, last_message_at DESC);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_images_user ON public.images(user_id);
CREATE INDEX idx_images_expires ON public.images(expires_at);
CREATE INDEX idx_usage_user_date ON public.usage_logs(user_id, created_at DESC);
CREATE INDEX idx_usage_type ON public.usage_logs(type);

-- ============================================
-- STEP 3: Functions & Triggers
-- ============================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function: ensure profile exists (called from app)
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS void AS $$
DECLARE
  v_user auth.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM auth.users WHERE id = auth.uid();
  IF v_user.id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (v_user.id, v_user.email, v_user.raw_user_meta_data->>'full_name')
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      updated_at = NOW();
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

CREATE TRIGGER on_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_timestamp();

-- ============================================
-- STEP 4: RLS (Simple - no circular refs)
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update only their own profile.
-- Admin-wide reads/writes are handled through server-side admin routes.
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (public.is_admin());

CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Conversations: user can only access own
CREATE POLICY "conversations_all" ON public.conversations
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "conversations_select_admin" ON public.conversations
  FOR SELECT USING (public.is_admin());

-- Messages: user can access messages in own conversations
CREATE POLICY "messages_all" ON public.messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
  );

CREATE POLICY "messages_select_admin" ON public.messages
  FOR SELECT USING (public.is_admin());

-- Images: user can only access own
CREATE POLICY "images_all" ON public.images
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "images_select_admin" ON public.images
  FOR SELECT USING (public.is_admin());

-- Usage logs: user can read own, anyone can insert
CREATE POLICY "usage_select" ON public.usage_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "usage_select_admin" ON public.usage_logs
  FOR SELECT USING (public.is_admin());

CREATE POLICY "usage_insert" ON public.usage_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- STEP 5: Helper functions
-- ============================================

CREATE OR REPLACE FUNCTION get_image_quota(p_user_id UUID)
RETURNS TABLE(used INT, remaining INT, reset_at TIMESTAMPTZ) AS $$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_used INT;
  v_limit INT;
BEGIN
  v_today_start := DATE_TRUNC('day', NOW());
  SELECT COALESCE(daily_image_limit, 15) INTO v_limit FROM profiles WHERE id = p_user_id;
  SELECT COUNT(*)::INT INTO v_used FROM usage_logs
    WHERE user_id = p_user_id AND type = 'image' AND created_at >= v_today_start;
  RETURN QUERY SELECT v_used, GREATEST(0, v_limit - v_used), v_today_start + INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_and_log_image_usage(
  p_user_id UUID,
  p_model TEXT DEFAULT 'cx/gpt-5.5-image'
)
RETURNS JSON AS $$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_used INT;
  v_limit INT;
  v_remaining INT;
  v_reset_at TIMESTAMPTZ;
  v_allowed BOOLEAN;
BEGIN
  v_today_start := DATE_TRUNC('day', NOW());

  SELECT COALESCE(daily_image_limit, 15) INTO v_limit
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  SELECT COUNT(*)::INT INTO v_used
  FROM usage_logs
  WHERE user_id = p_user_id
    AND type = 'image'
    AND created_at >= v_today_start;

  v_remaining := v_limit - v_used;
  v_allowed := v_remaining > 0;
  v_reset_at := v_today_start + INTERVAL '1 day';

  IF v_allowed THEN
    INSERT INTO usage_logs (user_id, type, model, tokens)
    VALUES (p_user_id, 'image', p_model, 0);

    v_used := v_used + 1;
    v_remaining := v_remaining - 1;
  END IF;

  RETURN json_build_object(
    'allowed', v_allowed,
    'used', v_used,
    'remaining', GREATEST(0, v_remaining),
    'reset_at', v_reset_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_expired_images()
RETURNS void AS $$
BEGIN
  DELETE FROM public.images WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- STEP 6: Create profile for ALL existing auth users
-- ============================================

INSERT INTO public.profiles (id, email, full_name)
SELECT id, email, raw_user_meta_data->>'full_name'
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  updated_at = NOW();

-- ============================================
-- STEP 7: Set super admin
-- GANTI 'YOUR_EMAIL@example.com' dengan email kamu
-- ============================================

UPDATE public.profiles
SET role = 'admin'
WHERE email = 'test@mail.com';

-- ============================================
-- DONE!
-- ============================================
