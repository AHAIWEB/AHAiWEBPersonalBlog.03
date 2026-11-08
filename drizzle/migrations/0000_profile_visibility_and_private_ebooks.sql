ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "Anyone can read profiles" ON public.profiles;
CREATE POLICY "Users can read visible profiles"
  ON public.profiles
  FOR SELECT
  TO anon, authenticated
  USING (
    is_public = true
    OR auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Public ebooks viewable" ON public.ebooks;
CREATE POLICY "Users can read own ebooks"
  ON public.ebooks
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ebooks read owner or public" ON storage.objects;
CREATE POLICY "ebooks read owner only"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ebooks'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );