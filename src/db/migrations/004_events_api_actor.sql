-- ============================================================
-- 004 — allow 'api' as an esign_events actor_type
--
-- An envelope created through POST /api/v1/envelopes has no human user and
-- isn't a pure internal system action either — it's a third actor type,
-- distinct in the audit trail from 'org_user' and 'system'. Same table
-- rebuild pattern as 003 (SQLite can't ALTER a CHECK constraint in place).
-- ============================================================

create table esign_events_new (
  id            integer primary key autoincrement,
  envelope_id   text not null references esign_envelopes(id),
  recipient_id  text references esign_recipients(id),
  actor_type    text not null check (actor_type in ('org_user','api','signer','system')),
  actor_user_id text references users(id),
  event_type    text not null,
  occurred_at   text not null,
  client_ip     text,
  user_agent    text,
  client_info   text,
  device_id     text,
  details       text not null default '{}',
  prev_hash     text not null,
  event_hash    text not null
);

insert into esign_events_new select * from esign_events;
drop table esign_events;
alter table esign_events_new rename to esign_events;

create index idx_events_envelope on esign_events (envelope_id, id);

create trigger esign_events_no_update before update on esign_events
  begin select raise(abort, 'esign_events is append-only'); end;
create trigger esign_events_no_delete before delete on esign_events
  begin select raise(abort, 'esign_events is append-only'); end;
