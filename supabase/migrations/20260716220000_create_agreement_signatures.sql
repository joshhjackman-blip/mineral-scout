-- Platform Services Agreement signatures. Every time a user signs the
-- agreement at /legal/agreement/sign the frontend inserts one row here.
-- The row is the electronic-signature audit trail referenced in the
-- Agreement's Section 15 (Miscellaneous > Electronic Signature).
--
-- Design notes
--   * Immutable — no UPDATE/DELETE via the anon key. If a user re-signs
--     (e.g. we publish a new version) that's a NEW row, not an update.
--   * Each row records enough metadata to defend the signature under
--     E-Sign / UETA: signatory name, email, entity, IP, user agent,
--     agreement version, and a UTC timestamp.
--   * Foreign key to auth.users so we can join per-account, and a
--     nullable user_id fallback so pre-auth signature attempts still
--     get captured (they'll show up unattributed and can be reconciled
--     manually).

CREATE TABLE IF NOT EXISTS public.platform_agreement_signatures (
  id BIGSERIAL PRIMARY KEY,

  -- Auth linkage (nullable so an unauthenticated visitor can still
  -- sign; recommend enforcing NOT NULL in a follow-up once the signup
  -- flow gates on being logged in first).
  user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,

  -- Signatory-provided fields captured on the sign form.
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signer_entity TEXT,          -- e.g. "Acme Minerals LLC" (nullable — individual signers)
  signer_title TEXT,           -- e.g. "Managing Partner" (nullable)

  -- Consent + version metadata.
  agreement_version TEXT NOT NULL,   -- matches the Version field in the .md file
  agreement_url TEXT NOT NULL DEFAULT '/legal/agreement',
  consent_checkboxes JSONB NOT NULL, -- {"read": true, "authority": true, "bound": true, "esign_consent": true}
  typed_signature TEXT NOT NULL,     -- The user types their full name to sign

  -- Request metadata for audit. IP / user_agent captured server-side
  -- via the API route (client-provided values are not trusted).
  ip_address INET,
  user_agent TEXT,

  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_agreement_signatures_user_id
  ON public.platform_agreement_signatures (user_id);

CREATE INDEX IF NOT EXISTS idx_platform_agreement_signatures_email
  ON public.platform_agreement_signatures (LOWER(signer_email));

CREATE INDEX IF NOT EXISTS idx_platform_agreement_signatures_signed_at
  ON public.platform_agreement_signatures (signed_at DESC);

ALTER TABLE public.platform_agreement_signatures ENABLE ROW LEVEL SECURITY;

-- Anon key can INSERT (so an unauthenticated visitor can sign) but not
-- SELECT / UPDATE / DELETE. Only the service role sees the audit trail.
DROP POLICY IF EXISTS "anon can insert signatures" ON public.platform_agreement_signatures;
CREATE POLICY "anon can insert signatures"
  ON public.platform_agreement_signatures
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Signed-in users can read their own signature history.
DROP POLICY IF EXISTS "user reads own signatures" ON public.platform_agreement_signatures;
CREATE POLICY "user reads own signatures"
  ON public.platform_agreement_signatures
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
