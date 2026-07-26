import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { canonicalSha256 } from "../../src/canonical.js";
import {
  H1PhysicalManifestError,
  parseH1PhysicalManifest,
  reconcileH1PhysicalManifestTables,
  resolveH1H0EmptinessTableSet,
  type H1PhysicalManifestIdentity,
  type H1PhysicalManifestTableAttestation,
} from "../../src/h1/physicalManifest.js";

async function readAuthorityJson(
  fileName: string,
): Promise<Record<string, any>> {
  const bytes = await readFile(
    new URL(`../../authority/r6/${fileName}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(bytes) as Record<string, any>;
}

function authoritySeedableTableUnion(
  fixture: Record<string, any>,
  delegation: Record<string, any>,
): readonly string[] {
  const h4 = delegation["h4AcceptanceProfileSuite"] as Record<string, any>;
  const rows = [
    ...(fixture["physicalSeedPlan"]["rows"] as Array<Record<string, any>>),
    ...(delegation["corpusProfiles"] as Array<Record<string, any>>).flatMap(
      (profile) => profile["rows"] as Array<Record<string, any>>,
    ),
    ...(h4["entitlementProfiles"] as Array<Record<string, any>>).flatMap(
      (profile) => profile["rows"] as Array<Record<string, any>>,
    ),
    ...(h4["participantProfiles"] as Array<Record<string, any>>).flatMap(
      (profile) =>
        (profile["rows"] as Array<Record<string, any>> | undefined) ?? [],
    ),
  ];
  return Object.freeze(
    [...new Set(rows.map((row) => row["table"] as string))].sort(),
  );
}

describe("H1 physical-domain manifest", () => {
  let rawManifest: Record<string, any>;
  let seedableTables: readonly string[];
  let identity: H1PhysicalManifestIdentity;

  beforeAll(async () => {
    const [manifest, fixture, delegation] = await Promise.all([
      readAuthorityJson("HEARTH-003-PHYSICAL-DOMAIN-MANIFEST-v3.json"),
      readAuthorityJson("HEARTH-003-FIXTURE-CONTRACT-v5.json"),
      readAuthorityJson("HEARTH-003-DELEGATION-MEASUREMENT-v2.json"),
    ]);
    rawManifest = manifest;
    seedableTables = authoritySeedableTableUnion(fixture, delegation);
    identity = parseH1PhysicalManifest(rawManifest);
  });

  it("derives the complete immutable table and ordered primary-key identity", () => {
    expect(identity).toMatchObject({
      schemaVersion: 3,
      artifactKind: "hearth-003-physical-domain-manifest",
      sourceCommit: "dae27a400868c0c686788ab8e5520690dbf77334",
      postgresVersion: "18.4",
    });
    expect(identity.migrationPinSetSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(identity.allTouchedTables).toHaveLength(29);
    expect(identity.allTouchedTables).toEqual(
      [...identity.allTouchedTables].sort(),
    );
    expect(new Set(identity.allTouchedTables)).toHaveLength(29);
    expect(Object.keys(identity.primaryKeysByTable)).toEqual(
      identity.allTouchedTables,
    );
    for (const table of identity.allTouchedTables) {
      const primaryKey = identity.primaryKeysByTable[table];
      expect(primaryKey).toBeDefined();
      expect(primaryKey?.length).toBeGreaterThan(0);
      expect(Object.isFrozen(primaryKey)).toBe(true);
    }
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.allTouchedTables)).toBe(true);
    expect(Object.isFrozen(identity.primaryKeysByTable)).toBe(true);
    expect(identity.manifestCanonicalSha256).toBe(canonicalSha256(rawManifest));
    expect(identity.allTouchedTablesSha256).toBe(
      canonicalSha256(identity.allTouchedTables),
    );
    expect(identity.primaryKeysByTableSha256).toBe(
      canonicalSha256(identity.primaryKeysByTable),
    );
  });

  it("reconciles the independently derived 29-table seedable union", () => {
    expect(seedableTables).toHaveLength(29);
    const attestation = reconcileH1PhysicalManifestTables(
      identity,
      seedableTables,
    );
    const resolved = resolveH1H0EmptinessTableSet(attestation);
    const resolvedAgain = resolveH1H0EmptinessTableSet(attestation);

    expect(attestation).toMatchObject({
      schemaVersion: 1,
      artifactKind: "hearth-search-h1-physical-manifest-table-attestation",
      physicalManifestSha256: identity.manifestCanonicalSha256,
      migrationPinSetSha256: identity.migrationPinSetSha256,
      h0TableCount: 29,
      h0TablesSha256: identity.allTouchedTablesSha256,
      primaryKeysByTableSha256: identity.primaryKeysByTableSha256,
    });
    expect(resolved).toEqual(identity.allTouchedTables);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(resolvedAgain).not.toBe(resolved);
  });

  it("RED: rejects missing tables in either reconciliation direction", () => {
    expect(() =>
      reconcileH1PhysicalManifestTables(identity, seedableTables.slice(1)),
    ).toThrow(/missing from authority/u);
    expect(() =>
      reconcileH1PhysicalManifestTables(identity, [
        ...seedableTables,
        "authority_extra_table",
      ]),
    ).toThrow(/missing from manifest/u);
  });

  it("RED: rejects a second primary constraint", () => {
    const firstTable = rawManifest["touchedTables"][0] as Record<string, any>;
    const constraints = firstTable["constraints"] as Array<Record<string, any>>;
    const primary = constraints.find(({ type }) => type === "p");
    expect(primary).toBeDefined();
    constraints.push({ ...primary });
    try {
      expect(() => parseH1PhysicalManifest(rawManifest)).toThrow(
        /primary constraints, expected exactly one/u,
      );
    } finally {
      constraints.pop();
    }
  });

  it("RED: rejects a primary-key column absent from table columns", () => {
    const firstTable = rawManifest["touchedTables"][0] as Record<string, any>;
    const constraints = firstTable["constraints"] as Array<Record<string, any>>;
    const primary = constraints.find(({ type }) => type === "p");
    const primaryColumns = primary?.["columns"] as string[];
    const priorColumn = primaryColumns[0];
    primaryColumns[0] = "missing_pk_column";
    try {
      expect(() => parseH1PhysicalManifest(rawManifest)).toThrow(
        /does not exist exactly once/u,
      );
    } finally {
      primaryColumns[0] = priorColumn!;
    }
  });

  it("RED: rejects duplicate table and column identities", () => {
    const tables = rawManifest["touchedTables"] as Array<Record<string, any>>;
    const priorLastTable = tables[tables.length - 1];
    tables[tables.length - 1] = tables[0]!;
    try {
      expect(() => parseH1PhysicalManifest(rawManifest)).toThrow(
        /duplicate table/u,
      );
    } finally {
      tables[tables.length - 1] = priorLastTable!;
    }

    const columns = tables[0]!["columns"] as Array<Record<string, any>>;
    const priorName = columns[1]?.["name"];
    columns[1]!["name"] = columns[0]!["name"];
    try {
      expect(() => parseH1PhysicalManifest(rawManifest)).toThrow(
        /duplicate column/u,
      );
    } finally {
      columns[1]!["name"] = priorName;
    }
  });

  it("RED: rejects a structural attestation clone", () => {
    const attestation = reconcileH1PhysicalManifestTables(
      identity,
      seedableTables,
    );
    const forged = {
      ...attestation,
    } as H1PhysicalManifestTableAttestation;
    expect(() => resolveH1H0EmptinessTableSet(forged)).toThrow(
      H1PhysicalManifestError,
    );
  });
});
