/**
 * keygen.mjs — OWNER-RUN backup encryption keypair generator.
 *
 * Generates one age X25519 keypair. Prints ONLY the public recipient to
 * stdout. Writes the PRIVATE identity to the file path you pass as the first
 * argument (default: ./backup-age-identity.key), with 0600 permissions.
 *
 * Run this on YOUR machine, not in CI or the cron service. The private
 * identity must go to your password manager / secret vault and be removed
 * from disk afterwards. It is NEVER committed, NEVER uploaded to R2, and
 * NEVER placed on the Railway backup service.
 *
 *   node apps/backup/scripts/keygen.mjs ./backup-age-identity.key
 *
 * Then: set R2/Railway AGE_RECIPIENT to the printed recipient; store the
 * identity file securely; delete the local file once stored.
 */
import { writeFileSync, chmodSync } from 'node:fs';
import * as age from 'age-encryption';

const outPath = process.argv[2] ?? './backup-age-identity.key';

const identity = await age.generateIdentity(); // "AGE-SECRET-KEY-1..."
const recipient = await age.identityToRecipient(identity); // "age1..."

writeFileSync(outPath, identity.trim() + '\n', { mode: 0o600 });
try {
  chmodSync(outPath, 0o600);
} catch {
  /* best effort on non-POSIX */
}

// PUBLIC recipient only — safe to share/configure.
console.log('\nBackup encryption keypair generated.\n');
console.log('  PUBLIC recipient (configure as AGE_RECIPIENT on Railway backup + monitor):');
console.log('    ' + recipient + '\n');
console.log('  PRIVATE identity written to: ' + outPath);
console.log('    → Store this in your password manager / secret vault.');
console.log('    → It is required ONLY for restore. Never commit it, never upload it,');
console.log('      never place it on the backup cron service.');
console.log('    → Delete the local file after secure storage is confirmed.\n');
