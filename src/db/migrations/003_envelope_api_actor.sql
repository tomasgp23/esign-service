-- ============================================================
-- 003 — allow an API-created envelope to have no human actor
--
-- An envelope sent through the new /api/v1 integration route has no logged
-- in user — created_by was NOT NULL because every envelope used to come
-- from the dashboard. SQLite can't drop a NOT NULL via ALTER TABLE, so the
-- table is rebuilt (drop + recreate + copy, same name restored before any
-- other table's foreign key is ever checked against it again).
-- ============================================================

create table esign_envelopes_new (
  id              text primary key,
  org_id          text not null references organizations(id),
  template_id     text references esign_templates(id),
  title           text not null,
  status          text not null default 'draft'
                    check (status in ('draft','sent','in_progress','completed','declined','voided','expired')),
  signing_order   text not null default 'parallel' check (signing_order in ('parallel','sequential')),
  merge_snapshot  text,
  original_path   text, original_sha256 text, page_count int,
  final_path      text, final_sha256   text,
  risk_flags      text not null default '[]',
  expires_at      text,
  created_by      text references users(id),
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_by         text references users(id), sent_at text,
  completed_at    text,
  voided_by       text references users(id), voided_at text, void_reason text
);

insert into esign_envelopes_new select * from esign_envelopes;
drop table esign_envelopes;
alter table esign_envelopes_new rename to esign_envelopes;

create index idx_envelopes_org on esign_envelopes (org_id);
create index idx_envelopes_status on esign_envelopes (status, expires_at);
