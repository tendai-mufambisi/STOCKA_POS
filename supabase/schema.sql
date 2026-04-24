create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  owner_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  shop_id text not null,
  name text not null,
  category text,
  unit text default 'each',
  reorder_level integer default 0,
  description text,
  current_quantity integer default 0,
  image_data text,
  source text default 'web',
  updated_by text,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (external_id, shop_id)
);

alter table public.shops enable row level security;
alter table public.products enable row level security;

create policy if not exists "authenticated_read_shops"
on public.shops for select
to authenticated
using (true);

create policy if not exists "authenticated_manage_products"
on public.products for all
to authenticated
using (true)
with check (true);
