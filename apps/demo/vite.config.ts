import { resolve } from "node:path";
// Bundle the demo into separate JS and CSS files under apps/demo/dist.
import { fileURLToPath } from "node:url";
import { presetUno } from "unocss";
import UnoCSS from "unocss/vite";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

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
        __dirname,
        "../../packages/solid-renderer/src/index.ts",
      ),
      "solid-js/web": resolve(
        __dirname,
        "../../packages/solid-renderer/src/index.ts",
      ),
    },
  },
  build: {
    lib: {
      entry: "src/index.tsx",
      formats: ["iife"],
      name: "BlitzJSApp",
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
