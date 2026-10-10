-- ==============================================================================
-- 🎵 乐谱库 (Music Score App) - Supabase 数据库与云存储一键初始化脚本 (纯净稳妥版)
-- ==============================================================================

-- 1. 开启 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. 创建用户资料表 (profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT,
    nickname TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 3. 自动同步新注册用户到 profiles 的触发器
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, nickname)
    VALUES (
        new.id, 
        new.email, 
        COALESCE(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1))
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. 创建乐谱主表 (scores)
CREATE TABLE IF NOT EXISTS public.scores (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    composer TEXT DEFAULT '',
    category TEXT DEFAULT 'classical',
    difficulty INTEGER DEFAULT 1,
    tags TEXT[] DEFAULT '{}',
    is_favorite BOOLEAN DEFAULT false,
    is_folder BOOLEAN DEFAULT false,
    folder_name TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    deleted_at TIMESTAMPTZ
);

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scores_manage_own" ON public.scores;
CREATE POLICY "scores_manage_own" ON public.scores FOR ALL 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_scores_user_updated ON public.scores(user_id, updated_at);

-- 5. 创建乐谱页面/多图与手写批注表 (score_pages)
CREATE TABLE IF NOT EXISTS public.score_pages (
    id TEXT PRIMARY KEY,
    score_id TEXT REFERENCES public.scores(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    page_order INTEGER NOT NULL DEFAULT 0,
    image_url TEXT NOT NULL,
    annotations JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.score_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "score_pages_manage_own" ON public.score_pages;
CREATE POLICY "score_pages_manage_own" ON public.score_pages FOR ALL 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_score_pages_score ON public.score_pages(score_id, page_order);

-- 6. 创建练琴每日打卡记录表 (checkins)
CREATE TABLE IF NOT EXISTS public.checkins (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    date TEXT NOT NULL,
    score_title TEXT DEFAULT '',
    duration INTEGER DEFAULT 30,
    notes TEXT DEFAULT '',
    mood TEXT DEFAULT '充实',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    deleted_at TIMESTAMPTZ
);

ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checkins_manage_own" ON public.checkins;
CREATE POLICY "checkins_manage_own" ON public.checkins FOR ALL 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON public.checkins(user_id, date);

-- 7. 初始化云端乐谱图片存储桶 (score-images)
INSERT INTO storage.buckets (id, name, public)
VALUES ('score-images', 'score-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "score_images_insert" ON storage.objects;
CREATE POLICY "score_images_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'score-images');

DROP POLICY IF EXISTS "score_images_manage_own" ON storage.objects;
CREATE POLICY "score_images_manage_own" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'score-images');

DROP POLICY IF EXISTS "score_images_select_public" ON storage.objects;
CREATE POLICY "score_images_select_public" ON storage.objects FOR SELECT TO public
USING (bucket_id = 'score-images');
