-- Storage policies for documents bucket (private, staff-only)
CREATE POLICY "documents_bucket_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND public.is_staff());

CREATE POLICY "documents_bucket_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND public.is_staff());

CREATE POLICY "documents_bucket_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND public.is_staff())
  WITH CHECK (bucket_id = 'documents' AND public.is_staff());

CREATE POLICY "documents_bucket_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND public.is_staff());
