# CBT Trainer — Clinical-Grade Offline-First CBT App (Foundational Architecture)

Production-oriented **foundational architecture** for a Cognitive Behavioral Therapy (CBT) mobile
app. It implements four load-bearing pillars an enterprise clinical app is built on:

1. **Offline-First encrypted persistence** — WatermelonDB with SQLCipher (AES-256 at rest).
2. **Deterministic clinical protocols** — XState v5 finite-state machine for the CBT Thought
   Record (ABC model), so clinical flow is decoupled from UI and provably legal-transition-only.
3. **Declarative React Native UI** — a screen that is a pure projection of machine state.
4. **Pre-LLM AI safety guardrails** — layered clinical triage that hard-stops dangerous input
   before any generative model runs, with crisis escalation and READI-aligned psychosis handling.

> This is a scaffold: it compiles and is unit-tested at the logic layer. Native encryption and
> the full RN runtime require a device/emulator build (see **Native Modules** below) and cannot
> be exercised in a headless CI sandbox.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | React Native + **Expo (Dev Client / prebuild)**, TypeScript (strict) |
| Styling | NativeWind v4 (Tailwind) |
| Protocol state | XState v5 |
| Local DB | WatermelonDB (Offline-First) |
| Encryption | SQLCipher (AES-256), key in `expo-secure-store` (Keychain / Keystore) |

## Why Dev Client, not Expo Go

WatermelonDB and SQLCipher are **native modules**. They do **not** run in Expo Go. The project
uses Expo's Continuous Native Generation (CNG): native folders are generated on demand and are not
committed. Build a custom Dev Client:

```bash
npm install
npx expo prebuild                 # generates ios/ and android/ from app.json (config plugins)
npx expo run:ios                  # or: npx expo run:android  (builds + installs the Dev Client)
```

### Wiring SQLCipher

WatermelonDB's default SQLite is not compiled with SQLCipher. To honor encryption, the native
SQLite must be SQLCipher-enabled and the passphrase handed over via `PRAGMA key`. All passphrase
plumbing is centralized in [`src/database/adapter.ts`](src/database/adapter.ts) — the only file to
touch when linking the SQLCipher build. The key itself is generated with a CSPRNG and stored in
hardware-backed secure storage; it never touches JS-accessible storage or logs.

## Project layout

```
App.tsx                              # bootstrap: mount encrypted DB → ensure user → render flow
src/
  security/encryptionKey.ts          # KeyProvider: CSPRNG 256-bit key in Keychain/Keystore
  database/
    schema.ts                        # appSchema: users, thought_records, clinical_tasks
    migrations.ts                    # additive, non-destructive migrations
    models/                          # decorated WatermelonDB models
    adapter.ts                       # SQLCipher passphrase handoff (single integration point)
    database.ts                      # idempotent async singleton mount
    sync.ts                          # Delta-Sync loop (Pull → Apply → Push, idempotent)
    repositories/                    # single-writer persistence (thought records, user)
  domain/thoughtRecord.ts            # shared ABC-model + distortion types
  machines/thoughtRecordMachine.ts   # XState v5 protocol machine (guards + save actor + retry)
  components/
    ThoughtRecordFlow.tsx            # declarative UI consuming the machine
    CrisisEscalation.tsx             # hard-stop escalation screen
    ui/PrimaryButton.tsx             # accessible action button
  safety/
    types.ts                         # SafetyReport / RiskCategory / EscalationPath
    analyzeInputSafety.ts            # layered System 1 + System 2 pre-LLM triage
    __tests__/                       # guardrail unit tests
```

## The four modules, mapped to requirements

### 1. Database & Security (Offline-First + SQLCipher)
- **Source of Truth is the device.** Every table carries `server_id`, `sync_status`,
  `created_at`, `updated_at`. Deletes are **soft** until the server acknowledges the tombstone.
- **Delta-Sync loop** (`sync.ts`): `synchronize()` runs Pull → Apply → Push against a
  `lastPulledAt` high-water mark. The server upserts on a stable key so a retried push after a
  dropped connection is **idempotent** — no duplicates.
- **Data-at-rest encryption**: the full SQLite file is AES-256 encrypted (SQLCipher). The key is
  device-only and non-exportable in backups (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), optionally gated
  by Face ID / fingerprint.

### 2. Clinical Protocol Machine (XState v5)
- States: `idle → analyzing_situation → identifying_emotions → catching_automatic_thoughts →
  tagging_distortions → restructuring_thought → saving_to_db → completed`, plus `error`.
- **Guards** make clinically-invalid transitions impossible (e.g. can't leave
  `tagging_distortions` with an empty list unless the patient explicitly bypasses; the automatic
  thought must be ≥ 3 words).
- **Save actor** (`fromPromise`) writes through the repository to encrypted WatermelonDB;
  `onError` → `error` with **bounded local retry**.
- Paste the machine into [Stately](https://stately.ai/) to visualize the full graph.

### 3. React Native Integration
- `ThoughtRecordFlow.tsx` consumes the machine via `useMachine` and renders each stage with an
  **exhaustive switch** on state — the UI cannot drift from the protocol.
- Accessibility: labeled inputs, `header`/`button`/`checkbox` roles, `accessibilityState`,
  48dp touch targets, high-contrast palette.

### 4. AI Safety Guardrails (pre-LLM triage)
- `validateTherapeuticInput(text): Promise<SafetyReport>` runs **System 1** (deterministic
  lexical rules) ∪ **System 2** (a mocked embedding classifier, swap-in point for a real
  on-device model). The most-acute signal decides the escalation via an **exhaustive switch**.
- A crisis flag returns `{ isSafe: false, requiresEscalation: true, escalationPath:
  'URGENT_HOTLINE' }` and the UI shows `CrisisEscalation` **instead of** invoking any LLM.
- Psychosis follows **READI**: de-escalate and offer human care, never confront or validate the
  delusion. Prompt-injection is rejected and guardrails re-asserted. The layer **fails closed**.

## Regulatory posture (HIPAA / Israeli Amendment 13)

A mental-health record store is **Medium/High** security under the Israeli Privacy Protection
(Data Security) Regulations 5777-2017 and HIPAA §164.312. This scaffold implements the technical
controls those regimes require: AES-256 at rest (SQLCipher), hardware-backed key custody, no PHI
in logs (rationales are non-identifying; `console` stripped in production builds), soft-delete +
tamper-evident audit signals, and TLS 1.3 + certificate pinning for the sync transport (to be
configured at the network layer). The **Right to Erasure** is implemented cryptographically:
destroying the key (`KeyProvider.destroyDatabaseKey`) shreds the database.

## Commands

```bash
npm run typecheck   # tsc --noEmit (strict) — primary logic gate
npm test            # jest — guardrail unit tests
npm run ios         # build + run the Dev Client (device/emulator only)
```
