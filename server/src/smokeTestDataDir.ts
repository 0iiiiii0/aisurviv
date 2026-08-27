import fs from "node:fs";
import path from "node:path";

/**
 * Destructive smoke tests must never guess a data directory. They are allowed
 * to clean only an explicitly supplied directory that is completely outside
 * the project/cwd tree. This prevents `SURVIV_DATA_DIR` omissions from turning
 * `.` into a recursive project wipe.
 */
export function prepareEmptySmokeTestDataDir(testName: string): string {
    const configured = process.env.SURVIV_DATA_DIR?.trim();
    if (!configured) {
        throw new Error(
            `${testName} requires an explicit temporary SURVIV_DATA_DIR`,
        );
    }

    const runDir = path.resolve(configured);
    const cwd = path.resolve(process.cwd());
    const projectRoot = path.resolve(__dirname, "../..");
    const fsRoot = path.parse(runDir).root;
    const overlaps = (a: string, b: string): boolean =>
        a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);

    if (
        runDir === fsRoot ||
        overlaps(runDir, cwd) ||
        overlaps(runDir, projectRoot)
    ) {
        throw new Error(
            `${testName} refusing to clean unsafe SURVIV_DATA_DIR: ${runDir}`,
        );
    }

    fs.rmSync(runDir, { recursive: true, force: true });
    fs.mkdirSync(runDir, { recursive: true });
    return runDir;
}
