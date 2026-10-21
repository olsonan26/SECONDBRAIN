# Recovering your brain without Vercel

Source code alone is not a brain backup. The backup system stores actual data
in **encrypted GitHub Release assets in this same repository**. Large original
page photos stay out of Git history, so cloning/deploying the app remains small.
No Git LFS subscription, paid hosting upgrade, or AI call is required to archive
or restore data. Standard Linux Actions are free for this public repository.

## Two different backups

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
An operator can import those exact records/originals into another private store,
preserving the session secret needed to decrypt saved model credentials. Do not
reset checkpoints, spend counters, or replace the live brain with a test fixture.

## Future snapshots

Actions -> **Brain recovery backup** -> **Run workflow** creates and verifies a
new cloud snapshot. Select the backend holding the real data. An empty Supabase
project is rejected rather than published as a successful backup.

The daily schedule is configured, but `BRAIN_BACKUP_ENABLED` stays `false` until
the Vercel-held workspace is recovered and the first complete cloud snapshot is
verified. Then set `BRAIN_BACKUP_BACKEND=supabase` and enable the daily job using
repository variables. A daily backup is not real-time protection: changes after
the last successful snapshot are not yet protected. Run a manual backup after
important work. Existing backups are not automatically deleted or overwritten.

The current Vercel quota block still prevents retrieving the latest 24 cloud
objects. GitHub cannot back up bytes the source provider refuses to return.
