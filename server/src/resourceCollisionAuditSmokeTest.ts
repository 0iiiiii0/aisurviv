import assert from "assert/strict";
import { buildResourceCollisionAudit } from "./resourceCollisionAudit.ts";

const report = buildResourceCollisionAudit();
assert(report.summary.resourceDefinitions > 100, "resource audit must cover the full definition set");
assert(report.summary.circleDefinitions > 0, "circle resources must be audited");
assert(report.summary.aabbDefinitions > 0, "AABB resources must be audited");
assert(report.summary.testedGeometryCases >= report.summary.resourceDefinitions * 16);
assert.deepEqual(report.issues, [], `resource collision audit issues:\n${report.issues.join("\n")}`);
console.log(
    `Resource collision audit passed: ${report.summary.resourceDefinitions} definitions, ` +
        `${report.summary.testedGeometryCases} transformed approach cases.`,
);
