export type HarnessErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

/**
 * Base class for fail-closed harness errors.
 *
 * Details must remain safe to write to a synthetic harness report. Callers must
 * never put credentials, query text, sentinel values, or database URLs in them.
 */
export abstract class HearthHarnessError<
  Code extends string,
> extends Error {
  readonly code: Code;
  readonly details: HarnessErrorDetails;

  protected constructor(
    code: Code,
    message: string,
    details: HarnessErrorDetails = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
