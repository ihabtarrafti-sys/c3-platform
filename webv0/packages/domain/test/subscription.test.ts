import { describe, expect, it } from 'vitest';
import { formatSubscriptionId, subscriptionCreateInputSchema, subscriptionUpdateInputSchema } from '../src/index';

const valid = { name: 'Adobe CC', vendorName: 'Adobe', amountMinor: 9900, currency: 'USD', cadence: 'Monthly', startedOn: '2026-01-01' };

describe('Track B — subscription domain', () => {
  it('formats the id', () => {
    expect(formatSubscriptionId(7)).toBe('SUB-0007');
  });

  it('validates a create: required fields, enums, non-negative amount', () => {
    expect(subscriptionCreateInputSchema.safeParse(valid).success).toBe(true);
    expect(subscriptionCreateInputSchema.safeParse({ ...valid, category: 'Software', nextRenewalOn: '2026-08-01', notes: 'team plan' }).success).toBe(true);
    expect(subscriptionCreateInputSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(subscriptionCreateInputSchema.safeParse({ ...valid, vendorName: '' }).success).toBe(false);
    expect(subscriptionCreateInputSchema.safeParse({ ...valid, amountMinor: -1 }).success).toBe(false);
    expect(subscriptionCreateInputSchema.safeParse({ ...valid, currency: 'XYZ' }).success).toBe(false);
    expect(subscriptionCreateInputSchema.safeParse({ ...valid, cadence: 'Fortnightly' }).success).toBe(false);
    expect(subscriptionCreateInputSchema.safeParse({ ...valid, startedOn: '01/01/2026' }).success).toBe(false);
    // strict: unknown keys rejected
    expect(subscriptionCreateInputSchema.safeParse({ ...valid, surprise: 1 }).success).toBe(false);
  });

  it('empty category/nextRenewal normalize to null', () => {
    const p = subscriptionCreateInputSchema.parse({ ...valid, category: '', nextRenewalOn: null });
    expect(p.category).toBeNull();
    expect(p.nextRenewalOn).toBeNull();
  });

  it('an update needs the version and at least one changed field', () => {
    expect(subscriptionUpdateInputSchema.safeParse({ expectedVersion: 0, amountMinor: 12000 }).success).toBe(true);
    expect(subscriptionUpdateInputSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(subscriptionUpdateInputSchema.safeParse({ amountMinor: 1 }).success).toBe(false); // missing version
  });
});
