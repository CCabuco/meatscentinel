-- MeatScentinel — 006 Storage policies
--
-- The record detail page loads the stored image via a signed URL. Signing
-- requires read permission on the object, and storage.objects has its own
-- policies independent of the table policies in 003 — without this, every
-- image request fails and the detail page shows "Image could not be
-- loaded".
--
-- Run this AFTER creating the private bucket named inspection-images.

-- Inspectors read inspection images. Administrators do not: the image is
-- inspection data, and the role boundary applies to it exactly as it
-- applies to the records themselves.
create policy "inspectors read inspection images"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'inspection-images'
    and is_inspector()
  );

-- No insert policy for `authenticated`.
--
-- The image file arrives from the collaborating mobile application, and
-- which credential it presents is V-17 — deferred, pending coordination
-- with that team. Granting insert to every signed-in inspector would let
-- the web application write image documentation, which is not something
-- any confirmed requirement asks for.
--
-- Until V-17 is resolved, upload test images through the Supabase
-- dashboard. Resolving it adds one insert policy here and one on
-- image_submissions in 003. Nothing else changes.

-- No update or delete policy, for any role. Image documentation is part
-- of the inspection record; the same reasoning that makes remarks and
-- status entries append-only applies to it.
