-- GWF RPG Edition — schema. The backend is a synchronized store, not a referee: every client appends events
-- and applies them with the same reducer. Row Level Security is on, and the policies are deliberately open
-- to the anon/publishable key (a game between friends); tightening them later is a policy change, not a rewrite.

create extension if not exists pgcrypto;

-- One row per room. `snapshot` is the latest reduced state (written by the TV every few events) so a phone
-- that joins late replays only the events after `snapshot_seq`.
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  seed bigint not null,
  mode text not null default 'ffa',
  tier int not null default 1,
  size text not null default 'regular',
  gm_pin_hash text not null default '',
  status text not null default 'lobby',
  last_seq int not null default 0,
  snapshot jsonb,
  snapshot_seq int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rooms_code_idx on rooms (code);
create index if not exists rooms_created_idx on rooms (created_at desc);

-- Append-only event log. seq is dense per room and assigned inside append_event under a row lock.
create table if not exists events (
  id bigserial primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  seq int not null,
  type text not null,
  actor text not null default 'system',
  ts bigint not null,
  payload jsonb not null default '{}'::jsonb,
  client_id text,
  created_at timestamptz not null default now(),
  unique (room_id, seq)
);
create index if not exists events_room_seq_idx on events (room_id, seq);

-- The roster belongs to an owner (a phone's anonymous identity). A 6-character claim code recovers it on a
-- new phone; the data blob holds characters, the vault and the pet collection.
create table if not exists roster_owners (
  id uuid primary key default gen_random_uuid(),
  claim_code text not null unique,
  device_ids text[] not null default '{}',
  display_name text,
  data jsonb not null default '{"characters":[],"vault":[],"pets":[],"veterans":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists roster_claim_idx on roster_owners (claim_code);
create index if not exists roster_devices_idx on roster_owners using gin (device_ids);

-- Names retired forever. Case-insensitive uniqueness is enforced on the normalised form.
create table if not exists wall_of_names (
  name_key text primary key,
  name text not null,
  owner_id uuid references roster_owners(id) on delete set null,
  character jsonb,
  cause text,
  room_code text,
  died_at timestamptz not null default now()
);

create table if not exists hall_of_fame (
  id bigserial primary key,
  room_id uuid references rooms(id) on delete set null,
  season_id int,
  kind text not null,             -- 'run' | 'legacy' | 'title'
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists seasons (
  id serial primary key,
  name text not null,
  nights int not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  data jsonb not null default '{}'::jsonb
);

-- Named challenge-list presets shared across rooms (In Person, Discord, Quick, plus the GM's own).
create table if not exists challenge_presets (
  id text primary key,
  name text not null,
  entries jsonb not null,
  updated_at timestamptz not null default now()
);

-- GM-only record of real buy-ins. A record, never a wallet: nothing reads it back into play.
create table if not exists meta_ledger (
  id bigserial primary key,
  room_id uuid references rooms(id) on delete set null,
  season_id int,
  player_name text not null,
  owner_id uuid,
  buy_in text,
  mode text,
  place int,
  character_name text,
  vaulted jsonb,
  notes text,
  created_at timestamptz not null default now()
);

-- Atomic append: lock the room, take the next seq, insert, return the row.
create or replace function append_event(p_room_id uuid, p_type text, p_actor text, p_ts bigint, p_payload jsonb, p_client_id text default null)
returns events language plpgsql security definer set search_path = public as $$
declare
  v_seq int;
  v_row events;
begin
  update rooms set last_seq = last_seq + 1, updated_at = now() where id = p_room_id returning last_seq into v_seq;
  if v_seq is null then raise exception 'no such room %', p_room_id; end if;
  insert into events (room_id, seq, type, actor, ts, payload, client_id)
    values (p_room_id, v_seq, p_type, p_actor, p_ts, coalesce(p_payload, '{}'::jsonb), p_client_id)
    returning * into v_row;
  if p_type in ('RUN_START', 'RUN_END', 'GM_END_RUN', 'CREATION_OPEN') then
    update rooms set status = case p_type when 'RUN_START' then 'playing' when 'CREATION_OPEN' then 'creation' else 'ended' end where id = p_room_id;
  end if;
  return v_row;
end $$;

-- Snapshot write: only moves forward.
create or replace function save_snapshot(p_room_id uuid, p_seq int, p_state jsonb)
returns void language sql security definer set search_path = public as $$
  update rooms set snapshot = p_state, snapshot_seq = p_seq, updated_at = now() where id = p_room_id and p_seq >= snapshot_seq;
$$;

-- Claim a roster on a new device: adds the device id to the owner and returns the owner row.
create or replace function claim_roster(p_claim_code text, p_device_id text)
returns roster_owners language plpgsql security definer set search_path = public as $$
declare v_row roster_owners;
begin
  update roster_owners set device_ids = array_append(array_remove(device_ids, p_device_id), p_device_id), updated_at = now()
    where claim_code = upper(p_claim_code) returning * into v_row;
  if v_row.id is null then raise exception 'no roster with that claim code'; end if;
  return v_row;
end $$;

-- Realtime: phones and the TV subscribe to inserts on events for their room.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'events') then
    alter publication supabase_realtime add table events;
  end if;
end $$;
alter table events replica identity full;

-- RLS: on everywhere, open to anon for this game's trust model.
alter table rooms enable row level security;
alter table events enable row level security;
alter table roster_owners enable row level security;
alter table wall_of_names enable row level security;
alter table hall_of_fame enable row level security;
alter table seasons enable row level security;
alter table challenge_presets enable row level security;
alter table meta_ledger enable row level security;

do $$ declare t text; begin
  foreach t in array array['rooms','events','roster_owners','wall_of_names','hall_of_fame','seasons','challenge_presets','meta_ledger'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert to anon, authenticated with check (true)', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for update to anon, authenticated using (true) with check (true)', t || '_update', t);
  end loop;
end $$;
-- Events are append-only: nobody updates or deletes them from a client.
drop policy if exists events_update on events;

grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on function append_event(uuid, text, text, bigint, jsonb, text) to anon, authenticated;
grant execute on function save_snapshot(uuid, int, jsonb) to anon, authenticated;
grant execute on function claim_roster(text, text) to anon, authenticated;

insert into seasons (name) select 'Season 1' where not exists (select 1 from seasons);
