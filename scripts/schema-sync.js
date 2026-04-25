#!/usr/bin/env node

/**
 * Supabase Schema Sync Helper
 * Validates and compares local schema with Supabase
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations');
const SCHEMA_FILE = path.join(__dirname, '../supabase/schema.sql');

function getMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('❌ No migrations directory found');
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

function printInstructions() {
  console.log('\n📋 SCHEMA SYNC WORKFLOW:\n');
  console.log('1. To CREATE a new migration:');
  console.log('   npx supabase migration new <description>');
  console.log('   Example: npx supabase migration new add_customers_table\n');

  console.log('2. Edit the generated migration file in supabase/migrations/\n');

  console.log('3. BEFORE pushing to Supabase, test locally:');
  console.log('   npx supabase start  (starts local Supabase)\n');

  console.log('4. Apply migration to local DB:');
  console.log('   npx supabase db pull  (pulls remote changes)\n');

  console.log('5. When ready, push to production:');
  console.log('   npx supabase db push  (pushes local migrations to remote)\n');

  console.log('6. View current migrations:');
  console.log('   npm run schema:list\n');

  console.log('⚠️  IMPORTANT:');
  console.log('  - Always test migrations locally before pushing');
  console.log('  - Keep supabase/schema.sql in sync with migrations');
  console.log('  - Commit migrations to git immediately after creating them');
}

function listMigrations() {
  const migrations = getMigrations();

  console.log('\n📁 Available Migrations:\n');

  if (migrations.length === 0) {
    console.log('   (none yet)\n');
    return;
  }

  migrations.forEach((file, index) => {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const lineCount = content.split('\n').length;
    console.log(`   ${index + 1}. ${file} (${lineCount} lines)`);
  });

  console.log('');
}

function main() {
  const command = process.argv[2];

  console.log('\n🔄 Supabase Schema Sync Helper\n');

  switch (command) {
    case 'list':
      listMigrations();
      break;
    case 'help':
    default:
      printInstructions();
      listMigrations();
  }
}

main();
