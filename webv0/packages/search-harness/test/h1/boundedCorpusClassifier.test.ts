import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import {
  assertExclusiveB0O0,
  classifyH1BoundedCorpus,
  H1BoundedCorpusClassificationError,
  type H1BoundedCorpusClassificationReceipt,
} from "../../src/h1/boundedCorpusClassifier.js";
import { planH1ActorMatrix } from "../../src/h1/actorMatrixPlan.js";
import { materializeH1BulkRows } from "../../src/h1/bulkRows.js";
import { canonicalSha256 } from "../../src/canonical.js";
import { planH1Corpus } from "../../src/h1/corpusPlanner.js";

async function readAuthorityJson(
  fileName: string,
): Promise<Record<string, any>> {
  const bytes = await readFile(
    new URL(`../../authority/r6/${fileName}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(bytes) as Record<string, any>;
}

describe("H1 bounded-corpus B0/O0 drift-baseline classification", () => {
  let fixture: Record<string, any>;
  let inputs: Parameters<typeof classifyH1BoundedCorpus>[0];
  let receipt: H1BoundedCorpusClassificationReceipt;

  beforeAll(async () => {
    const [
      loadedFixture,
      driftBaseline,
      authoritativePredicates,
      actorClasses,
      delegation,
    ] = await Promise.all([
      readAuthorityJson("HEARTH-003-FIXTURE-CONTRACT-v5.json"),
      readAuthorityJson("HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1.json"),
      readAuthorityJson("HEARTH-003-AUTHORITATIVE-PREDICATES-v2.json"),
      readAuthorityJson("HEARTH-003-ACTOR-CLASSES-v2.json"),
      readAuthorityJson("HEARTH-003-DELEGATION-MEASUREMENT-v2.json"),
    ]);
    fixture = loadedFixture;
    const corpusPlan = planH1Corpus(fixture);
    inputs = {
      fixture,
      driftBaseline,
      authoritativePredicates,
      actorClasses,
      corpusPlan,
      actorMatrixPlan: planH1ActorMatrix(actorClasses, delegation),
      bulkMaterialization: materializeH1BulkRows(corpusPlan),
    };
    receipt = classifyH1BoundedCorpus(inputs);
  }, 180_000);

  it("partitions every bounded source/profile coordinate exactly once", () => {
    expect(receipt).toMatchObject({
      measurementStatus: "NOT_YET_MEASURED",
      baselineMeaning: "dae27a4-drift-baseline-only",
      manifestInputs: {
        artifactKind: "hearth-search-h1-bounded-classification-receipt",
        measurementStatus: "NOT_YET_MEASURED",
        baselineMeaning: "dae27a4-drift-baseline-only",
        sourceCount: 100_037,
        actorProfileCount: 140,
        classificationCount: 14_005_180,
        intersectionCount: 0,
        unclassifiedCount: 0,
        hardCanarySourceCount: 37,
        hardCanaryClassificationCount: 5_180,
        forbiddenCanarySourceCount: 27,
        forbiddenCanaryClassificationCount: 3_780,
        securityCollisionCanarySourceCount: 10,
        securityCollisionCanaryClassificationCount: 1_400,
      },
    });
    expect(
      receipt.manifestInputs.b0Count + receipt.manifestInputs.o0Count,
    ).toBe(14_005_180);
    expect(receipt.manifestInputs.b0Count).toBeGreaterThan(0);
    expect(receipt.manifestInputs.o0Count).toBeGreaterThan(0);
    expect(
      receipt.manifestInputs.hardCanaryB0Count +
        receipt.manifestInputs.hardCanaryO0Count,
    ).toBe(5_180);
    expect(
      receipt.manifestInputs.forbiddenCanaryB0Count +
        receipt.manifestInputs.forbiddenCanaryO0Count,
    ).toBe(3_780);
    expect(
      receipt.manifestInputs.securityCollisionCanaryB0Count +
        receipt.manifestInputs.securityCollisionCanaryO0Count,
    ).toBe(1_400);
    expect(receipt.manifestInputs.forbiddenCanaryB0Count).toBeGreaterThan(0);
    expect(receipt.manifestInputs.forbiddenCanaryO0Count).toBeGreaterThan(0);
    expect(
      receipt.manifestInputs.securityCollisionCanaryB0Count,
    ).toBeGreaterThan(0);
    expect(
      receipt.manifestInputs.securityCollisionCanaryO0Count,
    ).toBeGreaterThan(0);
  });

  it("emits only aggregate counts and hashes, not a relabelled oracle", () => {
    expect(canonicalSha256(receipt.manifestInputs)).toBe(
      receipt.manifestSha256,
    );
    expect(receipt.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    for (const hash of [
      ...Object.values(receipt.manifestInputs.inputHashes),
      receipt.manifestInputs.sourceUniverseSha256,
      receipt.manifestInputs.b0O0PartitionSha256,
      receipt.manifestInputs.hardCanaryPartitionSha256,
      receipt.manifestInputs.forbiddenCanaryPartitionSha256,
      receipt.manifestInputs.securityCollisionCanaryPartitionSha256,
      receipt.manifestInputs.perProfileCountsSha256,
      receipt.manifestInputs.perRegisterCountsSha256,
    ]) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    }
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(
      inputs.corpusPlan.authoritySources[0]?.recordId,
    );
    expect(serialized).not.toContain("disclosure-correct");
    expect(serialized).not.toContain("disclosure-oracle");
  });

  it("RED: rejects both an omitted and a double classification", () => {
    expect(() =>
      assertExclusiveB0O0({ b0: false, o0: false }, "RED-omitted"),
    ).toThrow(H1BoundedCorpusClassificationError);
    expect(() =>
      assertExclusiveB0O0({ b0: true, o0: true }, "RED-double"),
    ).toThrow(H1BoundedCorpusClassificationError);
  });

  it("RED: rejects a hard-canary count that silently falls below 37", () => {
    const hardCanary = (fixture["fixtures"] as Array<Record<string, any>>).find(
      ({ relevance }) => relevance === "forbidden_canary",
    );
    expect(hardCanary).toBeDefined();
    const prior = hardCanary!["relevance"];
    hardCanary!["relevance"] = "relevant";
    try {
      expect(() => classifyH1BoundedCorpus(inputs)).toThrow(
        /forbidden canary source count/u,
      );
    } finally {
      hardCanary!["relevance"] = prior;
    }
  });
});
