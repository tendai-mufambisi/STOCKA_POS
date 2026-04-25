# 🗄️ Supabase Schema Synchronization Guide

## Overview
Your database schema is now version-controlled using Supabase migrations. All schema changes are tracked in `supabase/migrations/` and automatically sync with your Supabase project.

## Quick Reference

### Viewing Available Commands
```bash
npm run schema:help      # Show instructions
npm run schema:list      # List all migrations
```

### Local Development

#### Start local Supabase
```bash
npm run db:start
# This starts a local PostgreSQL instance at localhost:54322
# API runs at localhost:54321
```

#### Stop local Supabase
```bash
npm run db:stop
```

#### Pull latest remote changes
```bash
npm run db:pull
# Downloads any migrations from your Supabase project
```

### Creating Schema Changes

#### Step 1: Create a new migration
```bash
npm run schema:new add_table_name
# or: npx supabase migration new add_table_name
```

This creates a timestamped SQL file in `supabase/migrations/`

#### Step 2: Edit the migration file
Edit `supabase/migrations/TIMESTAMP_add_table_name.sql`

Example:
```sql
-- Create customers table
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null,
  email text,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add RLS policy
alter table public.customers enable row level security;
create policy "customers_access" on public.customers
  for all to authenticated using (true) with check (true);

-- Create index for shop_id
create index idx_customers_shop_id on public.customers(shop_id);
```

#### Step 3: Test locally (IMPORTANT!)
```bash
# Start local database
npm run db:start

# The migration is automatically applied to local DB
# Test your changes against the local database

# Stop when done
npm run db:stop
```

#### Step 4: Commit to git
```bash
git add supabase/migrations/TIMESTAMP_add_table_name.sql
git commit -m "feat: add customers table"
```

#### Step 5: Push to Supabase
When you're ready to deploy to production:
```bash
npm run db:push
# Pushes all local migrations to your remote Supabase project
```

## Important Rules

### ✅ DO:
- ✅ Create ONE migration per feature/change
- ✅ Test migrations locally before pushing
- ✅ Write descriptive migration names (e.g., `add_order_status_column`)
- ✅ Include comments in migrations explaining what they do
- ✅ Keep migrations in version control (git)
- ✅ Use `create table if not exists` and `drop table if exists` for safety

### ❌ DON'T:
- ❌ Manually edit tables directly in Supabase Console (they won't sync locally)
- ❌ Share migrations without testing locally first
- ❌ Mix unrelated changes in one migration
- ❌ Push migrations to production without local testing

## Understanding the File Structure

```
supabase/
├── config.toml                    # Supabase local config
├── schema.sql                     # Keep this as reference (optional)
└── migrations/
    ├── 20260425063155_initial_schema.sql
    ├── 20260425070000_add_customers_table.sql
    └── 20260425080000_add_orders_table.sql
```

Each migration file is automatically applied in timestamp order.

## Common Tasks

### List all migrations
```bash
npm run schema:list
```

### View pending local migrations (not pushed to remote)
```bash
npx supabase status
```

### Preview what will be pushed
```bash
# Dry run - shows what would be pushed
npx supabase db push --dry-run
```

### Rollback (recover from mistakes)
If you make a mistake before pushing:
```bash
# Option 1: Stop and delete local database
npm run db:stop
npx supabase stop --remove-db

# Option 2: Remove the migration file
rm supabase/migrations/TIMESTAMP_bad_migration.sql

# Start fresh
npm run db:start
```

## Syncing Between Team Members

When a teammate pushes a new migration:

```bash
# Pull their changes from git
git pull

# Apply their migrations to your local database
npm run db:pull

# Their schema is now in sync with yours locally!
```

## Troubleshooting

### "Migration already exists on remote"
- Push succeeded but your local state is out of sync
- Solution: `npm run db:pull` to sync local state

### "Local and remote schemas differ"
- You have uncommitted local changes
- Solution: `npm run db:pull` to see differences, or `git status` to check

### Local database won't start
```bash
# Reset everything
npm run db:stop
npx supabase stop --remove-db
npm run db:start  # Fresh start
```

## Reference Links

- [Supabase Migrations Docs](https://supabase.com/docs/guides/cli/managing-schemas)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli/supabase-db-push)
- Your local API: http://localhost:54321 (when running `npm run db:start`)
- Your project: https://app.supabase.com

---

**Questions?** Check `npm run schema:help` for quick reference!
