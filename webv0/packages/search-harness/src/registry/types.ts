export interface SearchProjectionRegistryEntry {
  readonly table: string;
  readonly match: readonly string[];
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly parent: string;
  readonly extraWhere: string | null;
}

export interface SearchResponseFieldRegistry {
  readonly envelope: readonly string[];
  readonly item: readonly string[];
  readonly application: readonly string[];
  readonly persistence: readonly string[];
}

export interface SunsetRegistrySnapshot {
  readonly roles: readonly string[];
  readonly capabilityKeys: readonly string[];
  readonly roleCapabilities: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  readonly moduleKeys: readonly string[];
  readonly entitlementStates: readonly string[];
  readonly entitlementSnapshots: readonly string[];
  readonly searchDomains: readonly string[];
  readonly applicationResultKinds: readonly string[];
  readonly contractResultKinds: readonly string[];
  readonly gateClasses: Readonly<Record<string, readonly string[]>>;
  readonly predicateRegisters: Readonly<Record<string, readonly string[]>>;
  readonly documentOwnerTypes: readonly string[];
  readonly recordKinds: readonly string[];
  readonly matchFields: Readonly<Record<string, readonly string[]>>;
  readonly responseFields: SearchResponseFieldRegistry;
  readonly projections: Readonly<Record<string, SearchProjectionRegistryEntry>>;
  readonly criticalSources: readonly string[];
  readonly criticalSourceFingerprints: Readonly<Record<string, string>>;
}

export const SUNSET_REASON_CODES = [
  'SUNSET_ROLE_ADDED',
  'SUNSET_ROLE_REMOVED',
  'SUNSET_ROLE_ORDER_CHANGED',
  'SUNSET_CAPABILITY_ADDED',
  'SUNSET_CAPABILITY_REMOVED',
  'SUNSET_CAPABILITY_ORDER_CHANGED',
  'SUNSET_CAPABILITY_COMPOSITION_CHANGED',
  'SUNSET_MODULE_KEY_ADDED',
  'SUNSET_MODULE_KEY_REMOVED',
  'SUNSET_MODULE_KEY_ORDER_CHANGED',
  'SUNSET_ENTITLEMENT_STATE_ADDED',
  'SUNSET_ENTITLEMENT_STATE_REMOVED',
  'SUNSET_ENTITLEMENT_STATE_ORDER_CHANGED',
  'SUNSET_ENTITLEMENT_SNAPSHOT_ADDED',
  'SUNSET_ENTITLEMENT_SNAPSHOT_REMOVED',
  'SUNSET_ENTITLEMENT_SNAPSHOT_ORDER_CHANGED',
  'SUNSET_SEARCH_KIND_ADDED',
  'SUNSET_SEARCH_KIND_REMOVED',
  'SUNSET_SEARCH_KIND_ORDER_CHANGED',
  'SUNSET_GATE_ADDED',
  'SUNSET_GATE_REMOVED',
  'SUNSET_GATE_CHANGED',
  'SUNSET_PREDICATE_REGISTER_ADDED',
  'SUNSET_PREDICATE_REGISTER_REMOVED',
  'SUNSET_PREDICATE_REGISTER_CHANGED',
  'SUNSET_OWNER_TYPE_ADDED',
  'SUNSET_OWNER_TYPE_REMOVED',
  'SUNSET_OWNER_TYPE_ORDER_CHANGED',
  'SUNSET_RECORD_KIND_ADDED',
  'SUNSET_RECORD_KIND_REMOVED',
  'SUNSET_RECORD_KIND_ORDER_CHANGED',
  'SUNSET_MATCH_FIELD_ADDED',
  'SUNSET_MATCH_FIELD_REMOVED',
  'SUNSET_MATCH_FIELD_ORDER_CHANGED',
  'SUNSET_RESPONSE_FIELD_ADDED',
  'SUNSET_RESPONSE_FIELD_REMOVED',
  'SUNSET_RESPONSE_FIELD_ORDER_CHANGED',
  'SUNSET_PROJECTION_ADDED',
  'SUNSET_PROJECTION_REMOVED',
  'SUNSET_PROJECTION_CHANGED',
  'SUNSET_CRITICAL_SOURCE_ADDED',
  'SUNSET_CRITICAL_SOURCE_REMOVED',
  'SUNSET_CRITICAL_SOURCE_ORDER_CHANGED',
  'SUNSET_CRITICAL_SOURCE_CHANGED',
] as const;

export type SunsetReasonCode = (typeof SUNSET_REASON_CODES)[number];

export interface SunsetRegistryFailure {
  readonly code: SunsetReasonCode;
  readonly path: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
}
