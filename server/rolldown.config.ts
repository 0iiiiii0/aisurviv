import fs from "node:fs";
import path from "node:path";
import { defineConfig, type RolldownOptions } from "rolldown";
import { stripBlockPlugin } from "../shared/utils/stripBlockPlugin.ts";

if (fs.existsSync("./dist")) {
    fs.rmSync("./dist", { recursive: true });
}

const config: RolldownOptions = {
    output: {
        dir: "./dist",
        format: "es",
        // HJSON is CommonJS and is intentionally bundled into smartBot so the
        // external compute package stays self-contained. The same shared
        // config module is present in the other ESM entries, so their bundled
        // HJSON calls also need Rolldown's Node require compatibility shim.
        polyfillRequire: true,
        sourcemap: true,
        topLevelVar: true,
        // gameServer is also imported by compatibility smoke tests, so its
        // public helpers must remain valid named ESM exports. Entries without
        // runtime exports still collapse to side-effect-only bundles.
        exports: "auto",
        minify: {
            compress: {
                unused: true,
            },
            mangle: false,
            codegen: {
                removeWhitespace: false,
            },
        },
    },
    optimization: {
        inlineConst: {
            mode: "all",
            pass: 3,
        },
    },
    treeshake: {
        manualPureFunctions: [
            "z.object",
            "z.array",
            "z.string",
            "z.boolean",
            "z.number",
            "z.enum",
        ],
        moduleSideEffects: false,
    },
    plugins: [
        stripBlockPlugin({
            start: "STRIP_FROM_PROD_SERVER:START",
            end: "STRIP_FROM_PROD_SERVER:END",
        }),
    ],
    platform: "node",
    external: (id: string) => {
        if (id.includes("uWebSockets.js")) return true;
        // smartBot.js is copied as a self-contained remote 50v50 runtime.
        // Bundle HJSON so the compute node only needs Node.js, not a separate
        // npm install or access to the monorepo's node_modules directory.
        if (id === "hjson") return false;
        // Legacy custom modules still contain extensionless relative imports.
        // They are local source, not packages, and must be bundled so the ESM
        // output never asks Node to resolve an extensionless filesystem path.
        if (id.startsWith(".") || id.startsWith("\0") || path.isAbsolute(id)) {
            return false;
        }
        return true;
    },
    transform: {
        define: {
            "process.env.NODE_ENV": "'production'",
        },
    },
};

export default defineConfig([
    {
        ...config,
        input: "src/gameServer.ts",
    },
    {
        ...config,
        input: "src/game/gameProcess.ts",
    },
    {
        ...config,
        input: "src/smartBot.ts",
    },
    {
        ...config,
        input: "src/api/index.ts",
    },
]);
