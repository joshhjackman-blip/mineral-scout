CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Team members table
CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  member_id UUID REFERENCES auth.users(id),
  invite_email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, invite_email)
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners can manage their team" ON public.team_members;
CREATE POLICY "owners can manage their team" ON public.team_members
  FOR ALL USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "members can view their invite" ON public.team_members;
CREATE POLICY "members can view their invite" ON public.team_members
  FOR SELECT USING (
    auth.uid() = member_id OR invite_email = (
      SELECT email FROM auth.users WHERE id = auth.uid()
    )
  );

-- Allow team member subscription linkage.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS team_owner_id UUID REFERENCES auth.users(id);

-- Default to solo seats.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS seat_count INTEGER DEFAULT 1;

-- Optional one-time backfill for current Team subscribers.
UPDATE public.subscriptions
SET seat_count = 3
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE raw_user_meta_data->>'stripe_price_id' = 'price_1TMV5WApvM8x57QBiOuEKhKA'
);
