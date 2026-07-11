/**
 * keygen.ts — HARDEN-2 H-02: generate the backup-signing keypair (Ed25519).
 *
 *   npm run keygen        (from apps/backup)
 *
 * Prints BOTH halves ONCE to the terminal and writes NOTHING to disk:
 *   - BACKUP_SIGNING_KEY  (PKCS#8 PEM, PRIVATE)  → the c3-backup-cron Railway
 *     service env + the owner's password manager. Never the repo, never chat.
 *   - BACKUP_VERIFY_PUBKEY (SPKI PEM, public)    → the restore-drill env (and
 *     safe to store anywhere — it only VERIFIES).
 *
 * Rotation = run again, swap both envs; older artifacts then need the restore
 * override flag (RESTORE_ALLOW_UNSIGNED) documented in restore-main.ts, or a
 * fresh signed backup (the next nightly).
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();

console.log('── BACKUP_SIGNING_KEY (PRIVATE — cron service env + password manager, nowhere else) ──');
console.log(priv);
console.log('── BACKUP_VERIFY_PUBKEY (public — restore drill env) ──');
console.log(pub);
console.log('Set both as MULTILINE env values exactly as printed (including BEGIN/END lines).');
