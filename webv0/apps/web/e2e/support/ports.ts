/**
 * ports.ts — the single source of truth for the e2e harness ports.
 *
 * These were duplicated across `playwright.config.ts`, `e2e-server.ts`'s
 * defaults and a hardcoded `http://127.0.0.1:4100` inside
 * `tablework-comms.spec.ts`. A spec that hardcodes the port is a latent version
 * of the very bug this module exists for: it can talk to a server the config
 * never started, and nothing would say so.
 *
 * ⚖️ THEY ARE FIXED, DELIBERATELY, FOR NOW. With two lanes on one machine,
 * fixed ports mean e2e SERIALIZES between lanes. That tax is accepted because
 * the alternative — allocating ports per run — has to thread the chosen port
 * into spec files, and getting that wrong points a spec at the wrong server,
 * which is the same silent-wrong class instance 57 is about. Serialization is
 * legible (the preflight names who holds the port); a mis-threaded dynamic port
 * would not be.
 *
 * If dynamic ports are wanted later, this module is the seam: everything else
 * already reads from here.
 */
export const E2E_API_PORT = 4100;
export const E2E_WEB_PORT = 5199;

/** Every port the harness needs free before it can honestly run. */
export const E2E_PORTS: readonly number[] = [E2E_API_PORT, E2E_WEB_PORT];

export const E2E_API_ORIGIN = `http://127.0.0.1:${E2E_API_PORT}`;
export const E2E_WEB_ORIGIN = `http://localhost:${E2E_WEB_PORT}`;
