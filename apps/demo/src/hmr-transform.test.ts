import { afterAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createServer } from "vite";
import solid from "vite-plugin-solid";

const renderer = resolve(
  import.meta.dir,
  "../../../packages/solid-renderer/src/index.ts",
);

const server = await createServer({
  root: import.meta.dir.replace(/\/src$/, ""),
  plugins: [
    solid({
      solid: {
        generate: "universal",
        moduleName: "@blitz-quick/solid-renderer",
      },
    }),
    {
      name: "hmr-test-disable-deps-optimizer",
      enforce: "post",
      configResolved(config) {
        config.optimizeDeps.noDiscovery = true;
        config.optimizeDeps.include = [];
      },
    },
  ],
  resolve: {
    alias: {
      "@blitz-quick/solid-renderer": renderer,
      "solid-js/web": renderer,
    },
  },
  server: { middlewareMode: true },
});

afterAll(async () => {
  await server.close();
}, 15_000);

test("Vite injects solid-refresh into universal renderer modules", async () => {
  const result = await server.transformRequest("/src/components/Switch.tsx");
  const code = result?.code ?? "";

  expect(code).toContain('from "/@solid-refresh"');
  expect(code).toContain("import.meta.hot = __vite__createHotContext(");
  expect(code).toContain('_$$refresh("vite", import.meta.hot, _REGISTRY)');
  expect(code).toContain("packages/solid-renderer/src/index.ts");
});

test("stateful pages have independent HMR boundaries", async () => {
  const dashboard = await server.transformRequest("/src/pages/Dashboard.tsx");
  const settings = await server.transformRequest("/src/pages/Settings.tsx");

  expect(dashboard?.code).toContain(
    'import.meta.hot = __vite__createHotContext("/src/pages/Dashboard.tsx")',
  );
  expect(settings?.code).toContain(
    'import.meta.hot = __vite__createHotContext("/src/pages/Settings.tsx")',
  );
});
