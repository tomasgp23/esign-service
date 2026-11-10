-- ============================================================
-- 001 — organizations, users, invites, and the e-sign module
-- (org-scoped port of the original single-tenant esign_* schema)
-- ============================================================

create table organizations (
  id                    text primary key,
  name                  text not null,
  name_normalized       text not null unique,
  primary_contact_email text,
  is_active             integer not null default 1,
  created_at            text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- org_id is nullable: a 'platform_admin' belongs to no single organization —
-- they sit above the client layer entirely, with full cross-org visibility.
-- 'org_admin'/'member' always have an org_id.
create table users (
  id               text primary key,
  org_id           text references organizations(id),
  email            text not null,
  email_normalized text not null,
  password_hash    text not null,
  role             text not null check (role in ('platform_admin','org_admin','member')),
  invited_by       text references users(id),
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (email_normalized) -- a person logs in with just email+password, no org to pick
);

create table invites (
  id          text primary key,
  org_id      text not null references organizations(id),
  email       text not null,
  role        text not null check (role in ('org_admin','member')),
  token_hash  text not null unique,
  invited_by  text references users(id),
  expires_at  text not null,
  accepted_at text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table user_sessions (
  id         text primary key,
  user_id    text not null references users(id),
  token_hash text not null unique,
  expires_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------- versioned legal texts (ERSD, intent, adoption, authority) ----------
create table esign_disclosures (
  id          integer primary key autoincrement,
  org_id      text not null references organizations(id),
  kind        text not null check (kind in ('ersd','intent','adoption','authority')),
  version     integer not null,
  body_md     text not null,
  sha256      text not null,
  is_active   integer not null default 0,
  approved_by text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (org_id, kind, version)
);

-- ---------- templates (new row per edit; envelopes point at the exact version) ----------
create table esign_templates (
  id            text primary key,
  org_id        text not null references organizations(id),
  family_key    text not null,
  version       integer not null,
  name          text not null,
  kind          text not null check (kind in ('html','pdf')),
  body_html     text,
  base_pdf_path text,
  field_layout  text,                 -- JSON array
  signer_roles  text not null default '["owner_1"]', -- JSON array
  esign_allowed integer not null default 0,
  is_active     integer not null default 1,
  created_by    text references users(id),
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (org_id, family_key, version)
);

-- ---------- envelopes ----------
create table esign_envelopes (
  id              text primary key,
  org_id          text not null references organizations(id),
  template_id     text references esign_templates(id),
  title           text not null,
  status          text not null default 'draft'
                    check (status in ('draft','sent','in_progress','completed','declined','voided','expired')),
  signing_order   text not null default 'parallel' check (signing_order in ('parallel','sequential')),
  merge_snapshot  text,               -- JSON
  original_path   text, original_sha256 text, page_count integer,
  final_path      text, final_sha256   text,
  risk_flags      text not null default '[]', -- JSON array
  expires_at      text,
  created_by      text not null references users(id),
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_by         text references users(id), sent_at text,
  completed_at    text,
  voided_by       text references users(id), voided_at text, void_reason text
);

create index idx_envelopes_org on esign_envelopes (org_id);
create index idx_envelopes_status on esign_envelopes (status, expires_at);

-- ---------- recipients (signers) ----------
create table esign_recipients (
  id               text primary key,
  envelope_id      text not null references esign_envelopes(id),
  role             text not null,              -- owner_1 | owner_2
  routing_order    integer not null default 1,
  full_name        text not null,
  email            text not null,
  mobile_e164      text,
  title            text,
  token_hash       text unique,                -- sha256(raw token); raw token never stored
  token_expires_at text,
  status           text not null default 'pending'
                     check (status in ('pending','sent','opened','verified','consented','signed','declined')),
  failed_otp_count integer not null default 0,
  locked_at        text,
  ersd_id          integer references esign_disclosures(id),
  intent_id        integer references esign_disclosures(id),
  authority_id     integer references esign_disclosures(id),
  consented_at text, verified_at text, first_viewed_at text,
  signed_at    text, declined_at text, decline_reason text,
  signature_type   text check (signature_type in ('drawn','typed')),
  signature_path   text, signature_sha256 text,
  typed_signature  text, typed_font text,
  sign_ip text, sign_user_agent text, sign_device_id text, sign_geo text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (envelope_id, role)
);

create index idx_recipients_envelope on esign_recipients (envelope_id);

-- ---------- fields ----------
create table esign_fields (
  id           text primary key,
  envelope_id  text not null references esign_envelopes(id),
  recipient_id text not null references esign_recipients(id),
  type         text not null check (type in ('signature','initials','date_signed','full_name',
                 'title','company','text','checkbox')),
  page         integer not null,            -- 1-based
  x real not null, y real not null,          -- PDF points, origin bottom-left of page
  width real not null, height real not null,
  required     integer not null default 1,
  label        text,
  value        text,
  completed_at text
);

create index idx_fields_envelope on esign_fields (envelope_id);

-- ---------- one-time codes ----------
create table esign_otps (
  id                 integer primary key autoincrement,
  recipient_id       text not null references esign_recipients(id),
  channel            text not null check (channel in ('sms','email')),
  destination_masked text not null,
  code_hash          text not null,
  expires_at         text not null,
  attempts           integer not null default 0,
  verified_at        text,
  created_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create index idx_otps_recipient on esign_otps (recipient_id, created_at);

-- ---------- signer sessions (after OTP) ----------
create table esign_sessions (
  id           text primary key,
  recipient_id text not null references esign_recipients(id),
  token_hash   text not null unique,
  device_id    text,
  ip           text,
  expires_at   text not null,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------- append-only, hash-chained audit trail ----------
create table esign_events (
  id            integer primary key autoincrement,
  envelope_id   text not null references esign_envelopes(id),
  recipient_id  text references esign_recipients(id),
  actor_type    text not null check (actor_type in ('org_user','signer','system')),
  actor_user_id text references users(id),
  event_type    text not null,
  occurred_at   text not null,
  client_ip     text,
  user_agent    text,
  client_info   text,                        -- JSON
  device_id     text,
  details       text not null default '{}',  -- JSON
  prev_hash     text not null,
  event_hash    text not null
);

create index idx_events_envelope on esign_events (envelope_id, id);

-- ---------- defense-in-depth: block mutation at the DB layer too ----------
-- (app code is the primary enforcement point — these triggers just mean a
-- stray UPDATE/DELETE anywhere in the codebase fails loudly instead of
-- silently corrupting the audit trail or rewriting legal text.)
create trigger esign_events_no_update before update on esign_events
  begin select raise(abort, 'esign_events is append-only'); end;
create trigger esign_events_no_delete before delete on esign_events
  begin select raise(abort, 'esign_events is append-only'); end;

create trigger esign_disclosures_no_update before update on esign_disclosures
  begin select raise(abort, 'esign_disclosures is append-only'); end;
create trigger esign_disclosures_no_delete before delete on esign_disclosures
  begin select raise(abort, 'esign_disclosures is append-only'); end;
