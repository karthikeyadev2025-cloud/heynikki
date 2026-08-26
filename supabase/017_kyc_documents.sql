-- KYC documents for DID assignment.
--
-- The carrier requires customer verification before a number is handed over,
-- so this gates the assign step in the admin panel. Files live in the PRIVATE
-- kyc-documents bucket; this table holds only the metadata and the review
-- decision. Never store the document itself in a row, and never make the
-- bucket public — these are identity documents.
create table if not exists kyc_documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  uploaded_by  uuid references auth.users(id) on delete set null,
  doc_type     text not null
               check (doc_type in ('gst','pan','aadhaar','business_reg','address_proof','other')),
  storage_path text not null,
  file_name    text,
  mime_type    text,
  size_bytes   bigint,
  status       text not null default 'pending'
               check (status in ('pending','approved','rejected')),
  review_note  text,
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz default now()
);

create index if not exists idx_kyc_tenant  on kyc_documents(tenant_id);
create index if not exists idx_kyc_status  on kyc_documents(status);

alter table kyc_documents enable row level security;

-- A tenant sees and uploads only its own documents. Review columns are
-- deliberately not writable here — approval goes through the admin API on
-- the service key, so a tenant cannot approve itself.
drop policy if exists kyc_select_own on kyc_documents;
create policy kyc_select_own on kyc_documents for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists kyc_insert_own on kyc_documents;
create policy kyc_insert_own on kyc_documents for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
