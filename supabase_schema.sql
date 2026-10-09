-- ============================================================
-- Schema setup for a fresh Supabase project (copy of مشروع سعود)
-- Run this once in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Projects table
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- Contracts table
create table public.contracts (
  id             uuid primary key default gen_random_uuid(),
  project_name   text not null references public.projects(name) on update cascade,
  client_name    text not null,
  unit_price     numeric not null,
  first_payment  numeric not null,
  contract_date  date not null,
  fields         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- Payments (installments) table
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  contract_id         uuid not null references public.contracts(id) on delete cascade,
  installment_number  int not null,
  label               text not null,
  amount              numeric not null,
  due_date            date not null,
  paid                boolean not null default false,
  paid_at             timestamptz,
  paid_amount         numeric not null default 0,
  notes               jsonb not null default '[]'::jsonb,
  contacted           boolean not null default false,
  contacted_at        timestamptz,
  last_reminded_at    timestamptz,
  reminder_count      int not null default 0
);

-- Cascade delete contracts when their project is deleted
alter table public.contracts
  drop constraint contracts_project_name_fkey,
  add constraint contracts_project_name_fkey
    foreign key (project_name) references public.projects(name)
    on update cascade on delete cascade;

-- Indexes
create index idx_contracts_project_name on public.contracts(project_name);
create index idx_payments_contract_id on public.payments(contract_id);

-- Realtime (the app subscribes to postgres_changes on these tables)
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.contracts;
alter publication supabase_realtime add table public.payments;

-- ============================================================
-- Row Level Security
-- The app only uses the anon key + Supabase Auth (signed-in users),
-- so allow full access to any authenticated user.
-- ============================================================
alter table public.projects enable row level security;
alter table public.contracts enable row level security;
alter table public.payments  enable row level security;

create policy "authenticated full access" on public.projects
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on public.contracts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on public.payments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
