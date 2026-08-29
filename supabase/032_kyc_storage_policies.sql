-- ══════════════════════════════════════════════════════════════
-- 032 — RLS policies for the kyc-documents bucket
--
-- A real customer hit this on 2026-08-29: every Aadhaar and GST upload
-- on /verification returned 400. The bucket existed, its mime types and
-- size limit were right, and a service-key upload succeeded — but
-- storage.objects has RLS enabled and NO policy named this bucket, and
-- RLS with no matching policy denies. Migration 017 created the
-- kyc_documents TABLE and its policies; the bucket was created by hand
-- afterwards and its policies were never written. The table half of the
-- feature has been correct and unusable for three days.
--
-- Path convention matches the app: {tenant_id}/{doc_type}-{ts}-{rand}.{ext}
-- Membership is resolved through tenant_users rather than
-- get_my_tenant_id() so a user who belongs to more than one business
-- reaches every folder they should — the sibling call-recordings and
-- knowledge-docs policies use the single-tenant helper and should be
-- revisited the day multi-tenant staff exist.
-- ══════════════════════════════════════════════════════════════

drop policy if exists kyc_storage_select on storage.objects;
create policy kyc_storage_select on storage.objects for select
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from tenant_users where user_id = auth.uid()
    )
  );

drop policy if exists kyc_storage_insert on storage.objects;
create policy kyc_storage_insert on storage.objects for insert
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from tenant_users where user_id = auth.uid()
    )
  );

-- Delete exists ONLY so the upload path can clean up an orphaned object
-- when its metadata row fails to insert. It is deliberately restricted to
-- documents that are still pending: once a reviewer has approved or
-- rejected an identity document, the customer must not be able to remove
-- the evidence the decision was made on. An object whose row is already
-- decided stays put; an object with no row at all is the orphan case and
-- is removable.
drop policy if exists kyc_storage_delete on storage.objects;
create policy kyc_storage_delete on storage.objects for delete
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from tenant_users where user_id = auth.uid()
    )
    and not exists (
      select 1 from kyc_documents d
      where d.storage_path = storage.objects.name
        and d.status <> 'pending'
    )
  );

-- No update policy on purpose: the app uploads with upsert:false, so a
-- submitted document can never be silently swapped for a different one
-- after it has been sent for review.
