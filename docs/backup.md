# Backup & Data Protection

Why the backup system is built the way it is. The code says *what* it does; this
says what it is defending against and which decisions are load-bearing, so that a
future change does not quietly undo one of them.

The product question the whole system exists to answer:

> If this computer died right now, what would the shop lose?

---

## The three places a copy can live

| Where | Protects against | Automatic? | Verified by Stocka? |
|---|---|---|---|
| This computer (`%APPDATA%/Stocka/backups`) | a corrupted or accidentally wiped database | yes | yes |
| External drive (USB stick / external HDD) | the computer being stolen, dropped, or dying | yes, whenever the drive is plugged in | yes — read back **on the drive** |
| Off-site (owner's Drive, phone, a stick kept at home) | fire, flood, burglary taking the shop | no — a person carries it out | **no, and it never claims to be** |

The first two are in the same room. That is not a detail — it is the reason the
third tier exists, and the UI is built to make that visible rather than to explain
it in a paragraph.

---

## Decisions that are load-bearing

### Backups go through `db.backup()`, never `fs.copyFile`

The database runs in WAL mode (`journal_mode = WAL`). A committed sale lives in
`stocka.db-wal` until a checkpoint folds it into the main file, so copying
`stocka.db` on its own can produce a backup that is silently missing the last
stretch of trading — or a torn page, if the copy raced a write.

SQLite's online backup API (`better-sqlite3`'s `db.backup()`) is the only correct
way to copy a live database. It is consistent, safe to run mid-sale, and produces a
single fully checkpointed file.

**If you ever add another place a backup is written, it goes through the engine.**

### Every backup is read back before it counts

A file existing on disk is not evidence of a working recovery copy. Every backup is
reopened, `PRAGMA quick_check`ed, and its core tables read. A copy that fails is
**deleted**, so the last known-good backup remains the newest thing standing — a
corrupt file left in place is worse than no file, because it looks like protection.

### Verification asks "is this a readable Stocka database", not "is this current"

`CORE_TABLES` lists only tables that have existed for as long as Stocka has. It is
tempting to list every table the app currently has; doing so would condemn every
backup taken before the newest feature shipped — which are exactly the backups
somebody reaches for in a crisis. Older backups are brought forward by the
migrations when restored.

**Do not add newly-migrated tables to `CORE_TABLES`.**

### Backups are a single self-contained file

A backup copied out of a WAL database is itself in WAL mode, so opening it (even to
verify it) creates `-wal` and `-shm` sidecars beside it. Every finished copy is
switched to `journal_mode = DELETE` to fold those back in.

This matters the moment somebody drags "the backup" onto a USB stick or into a
Drive folder: if it is really three files, they will take one of them.

### Restore clears the outgoing WAL sidecars

Restoring copies a backup over `stocka.db`. If the *previous* database's `-wal` and
`-shm` are left beside it, SQLite may try to recover a write-ahead log belonging to
a different database against the restored one. Delete them between closing and
copying.

### Restore runs the migrations

Boot runs `createTables` / `runMigrations` / `ensureIndexes`. A restore is the only
other moment a database arrives from outside, so it does the same — otherwise an
older backup comes back unmigrated and the app reads a schema missing tables until
somebody happens to restart it.

### Restore always takes a verified safety copy first

Named `stocka_pre-restore_*`, which rotation never reclaims. Same for
`stocka_pre-reset_*` before a test-data reset. A safety net nobody checked is not a
safety net, so these are verified like any other backup.

### Satellites never back themselves up

A satellite's database is a **partial mirror**: the delta sync deliberately never
ships `stock_movements`, `sale_holds`, or the analytics tables. A backup taken there
would look complete and silently not be.

Everything is gated on `lanConfig.mode !== CLIENT`. What a satellite *does* do is
ask Main for its backup health over `/lan/backup-health`, so the cashier standing at
till 2 can be told the Main computer needs its drive plugged in.

### The external drive is found by identity, not by drive letter

The same stick is `E:` today and `F:` tomorrow depending on what else is plugged in.
The drive carries a marker file (`Stocka Backups/stocka-drive.json`) holding an id
generated at setup, and detection asks which attached volume holds that marker —
a handful of `existsSync` calls, cheap enough to poll every few seconds.

PowerShell is used **only** to list drives with readable labels on the setup screen,
on demand. Note that `ConvertTo-Json` returns a bare object rather than an array
when exactly one drive matches; the parser handles both.

### Copies to the drive land under `.part` and are verified where they land

USB fails in ways local disks do not — pulled mid-copy, counterfeit, dying. The copy
is written as `<name>.part`, renamed into place only when complete, and then opened
and checked **on the drive**. A stick pulled mid-copy leaves a `.part` that the next
rotation clears, never something that looks like a backup.

### An off-site copy is *recorded*, never *verified*

Stocka writes a file; a person carries it somewhere. After that Stocka cannot open
it, re-read it, or notice it being deleted. So:

- the status value is `recorded`, never `protected`
- the fields are `recordedAt` / `recordedWhere`, and there is a test asserting **no
  key matching `/verified/i` can exist on that state**
- the UI says: *"Recorded from what you told Stocka. Stocka cannot open this copy or
  check it is still there."*

Exporting and recording are two separate user actions, because only the first is
something Stocka can vouch for.

**This is the honesty the feature is built on. Do not collapse the two.**

### Nothing is ever uploaded

There is no Google Drive integration, no account to connect, no API. The promise
that a shop's financial records stay in the building holds unless a person decides
to send them somewhere. The export is a file and a save dialog.

---

## The interface

### The shield counts places, not percentages

`BackupShield` fills in whole bands, one per real destination holding a current
copy. A percentage ("73% protected") is unfalsifiable — the owner cannot say what
the missing 27% is, cannot act on it, and cannot tell whether it moved because their
data got safer or because a constant changed. "2 of 3" always points at something
they can name.

### Protected is quiet; the display grows with the risk

A permanent green badge becomes furniture within a week and stops being read. A
protected shop gets one line. Everything louder is earned.

### Grouping is the argument

The detail panel splits into a solid **"In this shop"** bracket and a dashed
**"Outside the shop"** one. The gap between them carries the point that a paragraph
would only explain: everything in the first bracket shares one fate.

### The sign-in warning always has a way out

Escalation lives in the words and the weight, never in the exit:

| External copy age | What happens at sign-in |
|---|---|
| under 3 days | nothing — the dashboard strip carries it |
| 3–6 days | a warning, plainly worded |
| 7+ days | the same dialog with the consequence spelled out |

"Continue to Stocka" is the primary button, focused on open, and answers to both
Enter and Esc (these tills are keyboard-and-mouse; there is no touchscreen).

Software that holds a shop's ledger hostage over a forgotten USB stick has stopped
being a tool. It also destroys its own warning: the first thing anyone learns is to
click past it, and then it is worthless on the day it matters.

It deliberately does **not** fire for a shop that has no drive yet, or for a missing
off-site copy. Those are invitations on the dashboard, not dialogs in the way.

### Status is never colour alone

Every destination row carries an icon and a word as well as a tone.

---

## Where things live

```
electron/database/
  backupEngine.js      creating, verifying, rotating, state; the only writer of backup_state.json
  externalBackup.js    drive detection, copies to the drive, the watcher
  offsiteBackup.js     the exported file, its manifest, recording that a copy left

src/
  utils/backupProtection.js     assessProtection() — the single source of truth for
                                what every surface says about protection
  components/BackupShield.jsx   the mark (styles live beside it, on purpose)
  components/BackupHealth.jsx   the dashboard strip
  components/BackupSignInWarning.jsx

tests/backup/                   ~100 tests
```

### State files (in `%APPDATA%/Stocka/`)

- `backup_state.json` — `{ local, external, offsite }`. Deliberately **not** a table
  in the database: backup history has to survive being restored over, and a row
  inside `stocka.db` would be replaced by whatever the restored backup said about
  itself. `backupEngine` owns it; other modules go through
  `readStateSection` / `writeStateSection`.
- `backups/manifest.json` — what we know about each file in the folder, so the
  Backups screen can tell a copy this engine verified from one it merely found.
  Backups written by older versions were never checked, and showing them as
  "Checked" would be exactly the false assurance this replaced.

### Rotation

10 most recent, then one per day for 14 days, then one per week for 8 weeks.
`stocka_pre-restore_*` and `stocka_pre-reset_*` are excluded entirely.

---

## Recovery: what a replacement computer actually needs

Restoring the ledger is not the same as being back in business. The exported file's
manifest says so, so that it travels with the file:

1. Install Stocka and **activate it** — `license.dat` is machine-bound and is not in
   the backup.
2. Restore the backup (Settings → Backups → *Restore from a File…*).
3. **Re-pair any satellite tills** — `lan_config.json` holds a shared secret that is
   deliberately not exported.

Receipt numbering self-heals: `nextReceiptNumber` reseeds from the `sales` table
when its counter file is missing.

---

## Known rough edge

`src/database/domains/backup.js` still exposes the **legacy JSON export/import**
(`exportBackupAsFile` / `importBackupFromFile`). It hardcodes a table list that has
drifted: it omits `cash_movements`, `sale_holds`, `report_snapshots` and
`inventory_daily_snapshots`, and its import deletes rows before re-inserting without
a single transaction around the whole operation.

Nothing in the current backup UI depends on it except the per-row **Export** button
in the backups list. It should be removed or pointed at `backup:export-offsite`.
