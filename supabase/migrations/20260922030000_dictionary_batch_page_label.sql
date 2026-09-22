-- A photographed vocabulary pack must carry the page (or lesson/unit) it came
-- from. Keeping it in its own column makes homework references reliable; kind
-- and description remain human-readable compatibility copies.
ALTER TABLE public.dictionary_batches
  ADD COLUMN IF NOT EXISTS page_label text;

COMMENT ON COLUMN public.dictionary_batches.page_label IS
  'Printed page, lesson, unit or chapter reference for the pack source.';
