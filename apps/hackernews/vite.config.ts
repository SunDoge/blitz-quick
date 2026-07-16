import { resolve } from "node:path";
import { presetUno } from "unocss";
import UnoCSS from "unocss/vite";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

function disableSolidDependencyOptimizer(): Plugin {
  return {
    name: "blitz-quick-disable-solid-deps-optimizer",
    enforce: "post",
    configResolved(config) {
      if (config.command === "serve") {
        config.optimizeDeps.noDiscovery = true;
        config.optimizeDeps.include = [];
      }
    },
  };
}

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  plugins: [
    UnoCSS({ hmrTopLevelAwait: false, presets: [presetUno()] }),
    solid({
      solid: {
        generate: "universal",
        moduleName: "@blitz-quick/solid-renderer",
      },
    }),
    disableSolidDependencyOptimizer(),
  ],
  resolve: {
    alias: {
      "@blitz-quick/solid-renderer": resolve(
        import.meta.dirname,
        "../../packages/solid-renderer/src/index.ts",
      ),
      "solid-js/web": resolve(
        import.meta.dirname,
        "../../packages/solid-renderer/src/index.ts",
      ),
    },
  },
  build: {
    lib: {
      entry: "packages/index.tsx",
      formats: ["iife"],
      name: "HackerNewsApp",
      fileName: () => "bundle.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "bundle.[ext]",
      },
    },
    cssCodeSplit: false,
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
  },
});
