# Recovering your brain without Vercel

Source code alone is not a brain backup. The backup system stores actual data
in **encrypted GitHub Release assets in this same repository**. Large original
page photos stay out of Git history, so cloning/deploying the app remains small.
No Git LFS subscription, paid hosting upgrade, or AI call is required to archive
or restore data. Standard Linux Actions are free for this public repository.

**Recovery snapshots do not mean the original cloud work was recovered.** They
protect the source-recovered Supabase workspace and any new work saved there;
the original Vercel-only drafts, accepted Astrology teachings, checkpoint and
historical spending remain separately pending. Extraction stays locked until
that checkpoint/ledger recovery is safely resolved.

Verified archives published on 2026-10-21:

- [Original books, photographs and OCR](https://github.com/olsonan26/SECONDBRAIN/releases/tag/brain-backup-sources-39650985484)
- [Recovered Supabase workspace](https://github.com/olsonan26/SECONDBRAIN/releases/tag/brain-backup-recovery-20261021202909152)

Daily recovered-workspace backups are enabled only after the second archive
passed complete decryption/restore and GitHub asset-digest checks. They continue
to declare the older Vercel-only work incomplete rather than hiding that gap.

## Three different backups

- **Original-source archive:** the 1,029 local page photographs, their OCR files,
  both book PDFs, extraction requirements/source audits, local Main corpus, and
  encrypted local recovery configuration. It is explicitly **not** a copy of
  the current cloud Astrology nodes, saved drafts, or extraction checkpoint.
  Fixture brains/test jobs are excluded. The known original PDF stored in a
  fixture folder is included only as a book, not imported as a real brain.
- **Complete cloud snapshots:** real brain registries, corpora/nodes/edges,
  settings/writing instructions, drafts, runs, checkpoint and spending records,
  history/review archives, and stored originals. A missing required record or
  blocked download stops publication. Original photo bytes remain in the
  separate source archive rather than being uploaded again every day.
- **Recovered Supabase snapshots:** all current Supabase JSON records (including
  recovery provenance and newly saved work) and each private original referenced
  by their corpora. They require a valid pending, extraction-blocked recovery
  marker, nonempty Main/source-recovery Astrology corpora, registry and settings.
  Their manifests retain `completeCloudState: false` and explicitly identify
  `recoverySnapshot.pendingLegacyCloudRecovery: true`. Encrypted metadata also
  records the source snapshot date and recovery date. The original blocked
  Astrology UUID, teaching nodes, draft files and ledger are not invented.

Every archive has SHA-256 checksums for all parts and every original file,
AES-256-GCM authentication, and a separate recovery key. Uploads are initially
drafts and published only after GitHub's reported sizes/digests match. Archives
are restore-tested before publication. Never treat a source-only archive as a
complete current-workspace backup; inspect `completeCloudState` in manifest.json.

## Recovery key -- do this once

Keep an offline/password-manager copy of
`private/backup-recovery/RECOVERY-KEY.txt`. **Do not commit that file or paste it
in public.** There is also an encrypted GitHub Actions repository secret for
backup jobs. Losing your separate key makes manual archive decryption impossible.
The public repository contains neither plaintext API keys nor login passwords.
Configuration files are included only inside the encrypted source archive.

## Download and restore

Open this repository's Releases, choose a backup, and download `manifest.json`
plus **every** `archive.part-*.bin` asset into one folder. Clone the code/install
dependencies, supply the original key as `BRAIN_BACKUP_KEY` (or put it at the
private key path above), then run:

```powershell
node --import tsx scripts/brain-backup.ts restore PATH-TO-ARCHIVE NEW-EMPTY-DESTINATION
```

Restore refuses an existing destination. It checks ciphertext hashes and
authentication before extracting, rejects unsafe paths/duplicates, and verifies
all restored file hashes. Cloud records restore below `cloud/secondbrain/`.
For a verified complete cloud restore, inspect the import without writing:

```powershell
node --conditions=react-server --env-file=.env.supabase.local --import tsx scripts/restore-brain-to-supabase.ts PATH-TO-RESTORED-DATA
# After checking the destination, repeat with --apply to create missing records.
```

The importer rechecks every file hash and refuses source-only archives or a
destination containing different data. It verifies each saved record/original,
does not reset checkpoints or spending, and never automatically switches the
production site. Preserve the session secret needed to decrypt saved model credentials. Do not
reset checkpoints, spend counters, or replace the live brain with a test fixture.
That complete-cloud importer also refuses recovery snapshots; it must not be
used to replace the blocked original workspace with a source-recovered one.
Recovery snapshots can still be decrypted and inspected with the same `restore`
command. Restored records are below `cloud/secondbrain/`; their pending-recovery
marker must be preserved during any separately reviewed recovery deployment.

## Future snapshots

Actions -> **Brain recovery backup** -> **Run workflow** creates and verifies a
snapshot. `snapshot` uses the explicitly configured repository mode;
`recovery-snapshot` selects the current recovered Supabase dataset, while
`complete-snapshot` requires the genuine recovered original cloud records.
Select the backend holding the real data. Empty Supabase projects are rejected.

The daily schedule starts only after an explicit activation command exports,
restores, publishes and verifies the first snapshot. To protect the currently
recovered Supabase data while the legacy cloud remains incomplete, run:

```powershell
$env:BRAIN_BACKUP_BACKEND = 'supabase'
node --env-file=.env.supabase.local --import tsx scripts/brain-backup.ts activate-recovery-daily
```

This sets `BRAIN_BACKUP_MODE=recovery`, `BRAIN_BACKUP_BACKEND=supabase` and finally
`BRAIN_BACKUP_ENABLED=true` only after full restore and remote asset-hash checks
succeed. It does not mark the old Vercel data recovered or unlock paid scans.
Recovery publication independently rechecks a complete restore before its first
GitHub write. No upgrade, model call or plaintext secret upload occurs.

Once the genuine original cloud checkpoint and ledger have been recovered and
verified, `activate-daily` retains the stricter complete-cloud requirements and
switches the mode to `complete` only after the first verified full snapshot.
A failed snapshot stops before changing repository variables. After successful
publication, the schedule is held disabled while its backend/mode settings are
updated, then enabled last; a settings-write failure cannot activate partial
configuration. A daily backup is not real-time protection: changes after
the last successful snapshot are not yet protected. Run a manual backup after
important work. Existing backups are not automatically deleted or overwritten.

The current Vercel quota block still prevents retrieving the latest 24 cloud
objects. GitHub cannot back up bytes the source provider refuses to return.

Large source archives can also be assembled directly on GitHub's standard
runner: a small encrypted `seed` holds local OCR/PDF/configuration data and exact
Drive IDs, JPEG MIME metadata, byte sizes and SHA-256 values. The source-assembly
workflow fetches only those supplied public Drive images, checks every original
fingerprint, rebuilds the archive, and performs a full restore before publication.
It never changes Drive permissions or uses model credits. A seed by itself does
not contain the JPEG bytes and must not be called a complete original-source
backup. Interrupted draft uploads resume only when existing asset hashes match;
conflicting assets are never overwritten.
