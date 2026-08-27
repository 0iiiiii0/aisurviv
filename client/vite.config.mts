import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin, PluginOption, type ServerOptions } from "vite";
import { getConfig } from "../config.ts";
import { version } from "../package.json" with { type: "json" };
import { GIT_VERSION } from "../server/src/utils/gitRevision.ts";
import { stripBlockPlugin } from "../shared/utils/stripBlockPlugin.ts";
import { atlasBuilderPlugin } from "./atlas-builder/vitePlugin.ts";
import { codefendPlugin } from "./vite-plugins/codefendPlugin.ts";
import { ejsPlugin } from "./vite-plugins/ejsPlugin.ts";

/** Preserve the short URLs used by the custom admin and stash pages. */
function customPageRoutesPlugin(): Plugin {
    const route = (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void,
    ) => {
        const [pathname, query] = (req.url ?? "").split("?", 2);
        if (pathname === "/admin") {
            res.statusCode = 302;
            res.setHeader("Location", "/admin/");
            res.end();
            return;
        }
        if (pathname === "/admin/") {
            req.url = `/admin/index.html${query ? `?${query}` : ""}`;
        } else if (pathname === "/storage") {
            res.statusCode = 302;
            res.setHeader("Location", "/storage.html");
            res.end();
            return;
        }
        next();
    };

    return {
        name: "survev-custom-page-routes",
        configureServer(server) {
            server.middlewares.use(route);
        },
        configurePreviewServer(server) {
            server.middlewares.use(route);
        },
    };
}

export default defineConfig(({ mode }) => {
    const viteEnv = loadEnv(mode, process.cwd(), "VITE_");
    const isDev = mode === "development";

    const Config = getConfig(!isDev, "");

    process.env.VITE_TURNSTILE_SCRIPT = "";
    if (Config.secrets.TURNSTILE_SITE_KEY) {
        process.env.VITE_TURNSTILE_SCRIPT =
            `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>`;
    }

    process.env.VITE_DEBUG_CSS_LINK = isDev
        ? `<link href='css/dev.css' rel="stylesheet" />`
        : "";
    process.env.VITE_GAME_VERSION = version;

    process.env.VITE_SPELLSYNC_PROJECT_ID = Config.secrets.SPELLSYNC_PROJECT_ID;
    process.env.VITE_SPELLSYNC_PUBLIC_TOKEN = Config.secrets.SPELLSYNC_PUBLIC_TOKEN;

    const plugins: PluginOption[] = [
        ejsPlugin(),
        ...atlasBuilderPlugin(mode === "production"),
        customPageRoutesPlugin(),
    ];

    if (!isDev) {
        plugins.push(codefendPlugin());

        plugins.push(
            stripBlockPlugin({
                start: "STRIP_FROM_PROD_CLIENT:START",
                end: "STRIP_FROM_PROD_CLIENT:END",
            }),
        );
    }

    const serverOptions: ServerOptions = {
        port: Config.vite.port,
        host: Config.vite.host,
        proxy: {
            // this redirects /stats to /stats/
            // because vite is cringe and does not work without trailing slashes at the end of paths 😭
            "^/stats(?!/$).*": {
                target: `http://${Config.vite.host}:${Config.vite.port}`,
                rewrite: (path) => path.replace(/^\/stats(?!\/$).*/, "/stats/"),
                changeOrigin: true,
                secure: false,
            },
            "/admin-api": {
                target: `http://${Config.gameServer.host}:${Config.gameServer.port}`,
                changeOrigin: true,
                secure: false,
            },
            "/api/duel-lobby": {
                target: `http://${Config.gameServer.host}:${Config.gameServer.port}`,
                changeOrigin: true,
                secure: false,
            },
            "/api/live-announcement": {
                target: `http://${Config.gameServer.host}:${Config.gameServer.port}`,
                changeOrigin: true,
                secure: false,
            },
            "/api/aim-training": {
                target: `http://${Config.gameServer.host}:${Config.gameServer.port}`,
                changeOrigin: true,
                secure: false,
            },
            "/api/spectate": {
                target: `http://${Config.gameServer.host}:${Config.gameServer.port}`,
                changeOrigin: true,
                secure: false,
            },
            // The remote 50v50 GUI connects through the public client port.
            // Keep this before the generic /api proxy, which targets the
            // account API and otherwise returns 404 for worker registration.
            "/api/remote-faction-worker": {
                target: `http://${Config.gameServer.host}:${Config.gameServer.port}`,
                changeOrigin: true,
                secure: false,
                // Registration derives the worker callback address from the
                // incoming Tailscale/LAN peer. Forward it through Vite instead
                // of making the game server see only 127.0.0.1.
                xfwd: true,
            },
            "/api": {
                target: `http://${Config.apiServer.host}:${Config.apiServer.port}`,
                changeOrigin: true,
                secure: false,
            },
            "/team_v2": {
                target: `http://${Config.apiServer.host}:${Config.apiServer.port}`,
                changeOrigin: true,
                secure: false,
                ws: true,
            },
        },
    };

    return {
        appType: "mpa",
        base: "",
        build: {
            target: "es2022",
            chunkSizeWarningLimit: 2000,
            rollupOptions: {
                input: {
                    main: resolve(import.meta.dirname, "index.html"),
                    stats: resolve(import.meta.dirname, "stats/index.html"),
                    storage: resolve(import.meta.dirname, "storage.html"),
                    extraction: resolve(import.meta.dirname, "extraction.html"),
                    viewStash: resolve(import.meta.dirname, "view-stash.html"),
                    ...(isDev
                        ? {
                            "building-editor": resolve(
                                import.meta.dirname,
                                "building-editor/index.html",
                            ),
                        }
                        : {}),
                },
                output: {
                    assetFileNames(assetInfo) {
                        if (assetInfo.names[0]?.endsWith(".css")) {
                            return "css/[name]-[hash][extname]";
                        }
                        return "assets/[name]-[hash][extname]";
                    },
                    entryFileNames: "js/[hash].js",
                    chunkFileNames: "js/[hash].js",
                },
            },
        },
        resolve: {
            extensions: [".ts", ".js"],
            alias: {
                "@/sdk.ts": viteEnv?.VITE_ENABLE_SURVEV_ADS === "true"
                    ? "./sdk-manager.prod"
                    : "./sdk-manager",
            },
        },
        define: {
            GAME_REGIONS: Config.regions,
            GIT_VERSION: JSON.stringify(GIT_VERSION),
            PING_TEST_URLS: Object.entries(Config.regions).map(([key, data]) => {
                return {
                    region: key,
                    zone: key,
                    url: data.address,
                    https: data.https,
                };
            }),
            PASS_TYPE: JSON.stringify(Config.passType),
            AD_PREFIX: JSON.stringify(Config.secrets.AD_PREFIX),
            VITE_GAMEMONETIZE_ID: JSON.stringify(Config.secrets.GAMEMONETIZE_ID),
            SPELLSYNC_PROJECT_ID: JSON.stringify(Config.secrets.SPELLSYNC_PROJECT_ID),
            SPELLSYNC_PUBLIC_TOKEN: JSON.stringify(Config.secrets.SPELLSYNC_PUBLIC_TOKEN),
            IS_DEV: isDev,
            PROXY_DEFS: JSON.stringify(Config.proxies),
            TURNSTILE_SITE_KEY: JSON.stringify(Config.secrets.TURNSTILE_SITE_KEY),
        },
        plugins,
        json: {
            stringify: true,
        },
        server: serverOptions,
        preview: serverOptions,
    };
});
