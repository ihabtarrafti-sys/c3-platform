/**
 * mailer.ts — S10: email as a DELIVERY CHANNEL of the L2 notification rows,
 * never a separate system. Dispatch is POST-COMMIT and BEST-EFFORT: a mail
 * failure never breaks the operation it narrates (the row is the truth; the
 * email is a courtesy copy). Fails closed: no SMTP config → null mailer →
 * rows-only, stated honestly.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from './env';
import type { Logger } from 'pino';

export interface Mailer {
  /** Fire-and-forget; errors are logged, never thrown. */
  send(to: string, subject: string, text: string): void;
}

export function createMailer(env: Env, log: Logger): Mailer | null {
  if (!env.smtp) return null;
  const transport: Transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
  });
  const from = env.smtp.from;
  return {
    send(to, subject, text) {
      transport
        .sendMail({ from, to, subject, text })
        .then(() => log.info({ to, subject }, 'notification email sent'))
        .catch((err: unknown) => log.warn({ err, to, subject }, 'notification email failed (rows remain the truth)'));
    },
  };
}
