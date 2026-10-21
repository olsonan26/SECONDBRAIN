# Secondbrain private persistence

This adapter keeps persistent JSON records in Supabase Postgres and original
uploaded files in a **private** `secondbrain-private` Storage bucket. Vercel
continues serving Next.js and its thin authenticated API. No database service
credential or gateway credential is exposed to the browser.

## Current migration status (2026-10-21)

- Dedicated project: `gocduruhpoyshixuqhrc` (SECONDBRAIN, Free plan).
- Schema and authenticated storage Edge Function deployed and verified live.
- Table RLS enabled; browser/anonymous roles have no table or RPC privileges.
  No client RLS policies is intentional: this is exclusively server-side data.
  The advisor's informational [RLS-with-no-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
  documents that default-deny posture; do not add public policies to silence it.
- Live tests verified missing records, create-only writes, stale-version
  rejection, six concurrent saves (one winner), private binary download hashes,
  duplicate-original rejection, and unauthorized request rejection.
- The user authorized a **source-recovery Supabase cutover**, not a claim that
  the suspended Vercel workspace was fully recovered. Eight private records and
  both original PDFs were uploaded and read-back fingerprint verified. Main's
  74 sources / 2,348 passages / 565 nodes / 825 edges are preserved unchanged.
- `Astrology (recovered sources)` has its own UUID
  `5c9e08c7-21fd-4c8e-95a1-1c6830ff092d`, three source-document nodes, 2,749
  passages, 1,028 unique image references, and 493 requirements. It does **not**
  impersonate the original Astrology brain or fabricate its accepted teachings.
- Shared OpenRouter settings/writing guidance were restored; the supplied key
  was validated using the free key endpoint and encrypted with the existing
  session secret. Both original login accounts remain unchanged.
- Vercel Blob remains quota-suspended. Listing its 24 objects works but actual
  content reads are forbidden. Original cloud-only drafts, accepted Astrology
  teachings, scan checkpoint and historical spending remain unrecovered.
  Durable recovery metadata blocks replacement paid scans and labels spending
  unavailable, not zero. Local fixture registries/jobs/drafts are never imported.
- The book contains two invisible NUL characters rejected by Postgres JSONB.
  A fingerprint-checked lossless JSON envelope preserves them exactly; logical
  reads, lists and encrypted backups decode them without modifying source text.
- No paid AI calls, plan upgrade, password change, source deletion, or scan reset
  is part of this migration. Preserve `BRAIN_SESSION_SECRET` unchanged so existing
  encrypted model credentials and sessions remain usable.

## Server configuration

A separate fresh scan was authorized after source recovery. Its dedicated
`recovery-fresh-scan.json` binds one job ID to the original photo source hash
and a new $10 total cap across all three passes. The global recovery marker and
unknown historical ledger remain unchanged. Only that brain/job is unlocked;
completed scans cannot be replaced to obtain another budget. The spending UI
labels fresh-scan totals separately from unavailable earlier spending.

`BRAIN_STORAGE_BACKEND` explicitly selects `supabase`, `blob`, or `local`.
When unset, legacy Blob/local detection is preserved. Cloud failures never fall
back to local storage or masquerade as an empty corpus.

For Supabase, the server also needs `BRAIN_SUPABASE_URL` and
`BRAIN_SUPABASE_GATEWAY_TOKEN`. The ignored `.env.supabase.local` contains the
generated connection. Never commit it or display its token in logs/chat.

The Edge Function uses its built-in Supabase server key. Its custom bearer
authentication compares the incoming token's SHA-256 fingerprint before IO.
Platform JWT verification is disabled because this endpoint verifies its own
opaque server credential; it is not an unauthenticated browser API.

Run `scripts/prepare-supabase.ts` with `SECONDBRAIN_SUPABASE_PROJECT` set to the
dedicated project ref. This generates a deployment JSON in ignored
`private/migration/`, containing only a token fingerprint. Deploy that bundle
using the connected Supabase tool. Keep `import_map_path: deno.json` explicit on
updates. The checked-in auth-config placeholder intentionally authorizes nobody.

## Source-recovery cutover

`scripts/recover-local-to-supabase.ts` defaults to a read-only preflight. Its
explicit `--apply` path accepts only the dedicated project and known original
inventories, creates missing records without overwriting different data, and
verifies every private PDF and logical JSON hash. `--with-key` accepts the
already-authorized model credential through hidden terminal input, never a
command-line argument. Writing guidance stays in an ignored local file.

`private/migration/local-source-recovery/manifest.json` records completion of
this **source recovery**, separately from the incomplete legacy Blob manifest.
`scripts/configure-supabase-production.ts --apply` rechecks its record hashes
before configuring only the three Supabase/backend production variables.
It does not change the session secret, users, or the old Blob store.

`scripts/verify-supabase-recovery-live.ts` checks both logins, exact inventories,
PDF/image hashes, shared settings, recovery UI and blocked paid extraction. It
does not start a model. The old browser brain URL redirects to the explicitly
labelled recovery brain; API brain boundaries remain strict.

## Later recovery of the original cloud-only work

Do not run a full migration over an actively edited recovery workspace. First
export the old store into a separate staging destination, reconcile registry,
settings and drafts, and verify the original checkpoint/ledger before clearing
the recovery restriction. The strict full-cloud migration below deliberately
refuses conflicting destination records and source-only replacements.

1. Obtain legitimate read access or an export of the suspended existing store
   `secondbrain-private-library` (`store_9YLLf65V7iim2Vxp`). Do not delete it,
   remove authentication, change plans without approval, or try quota bypasses.
2. Verify the Supabase destination (commands below). Then run migration. It
   inventories the actual cloud workspace, saves a private local export, uses
   create-only destination writes, and checks every original's bytes and each
   JSON record's canonical content. A conflicting destination stops the copy.
3. Require `private/migration/blob-export/manifest.json` to say `complete: true`
   and all source objects verified. The source inventory must be unchanged at
   the end. Quiesce workspace writes during this final copy/cutover.
4. Stage the two server connection variables in the correct Vercel project,
   leaving session secret, users, and model settings unchanged. Only after all
   checks pass, set `BRAIN_STORAGE_BACKEND=supabase` and deploy.
5. Verify both real logins, Main's 74 sources, Astrology's 3 sources and 42
   accepted teachings, 1,028 image passages, source PDF/image fingerprints,
   shared writing rules, and the paused job's exact checkpoint/cost ledger.
   Do not confuse conservative reservation accounting with measured provider
   spend. Preserve the existing cumulative cap and every accounted call.
6. Keep the old store/export intact for recovery. No auto-delete is implemented.

```powershell
# Run from the SECONDBRAIN repository. These operations do not start models.
node --conditions=react-server --env-file=.env.supabase.local --import tsx scripts/verify-supabase-storage.ts
node --conditions=react-server --env-file=.env.local --env-file=.env.supabase.local --import tsx scripts/migrate-blob-to-supabase.ts
```

The integrity probe creates small, uniquely named diagnostic records/originals;
they are not attached to a brain and do not appear as knowledge nodes.

## Capacity and follow-up

The existing persistent store is about 22.5 MB. Original Google Drive page
photos total about 2.85 GB and are **not** blindly copied into Supabase's free
Storage allowance; existing authenticated Drive-backed image delivery remains.
Moving providers does not make storage or model usage unlimited. This first
adapter retains compatible JSON records; large corpora and growing audit logs
still need quota monitoring and eventual partitioning to reduce repeated IO.
Idle progress/activity polling is once a minute, active polling seven seconds,
and hidden tabs do not poll. The browser driver already refreshes after steps,
so its separate progress poll does not issue duplicate reads.
