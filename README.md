# Blitz-Quick

**Blitz-Quick** is an experimental, ultra-minimal, and high-performance cross-platform UI rendering architecture. It completely discards heavy browser kernels (Chromium/WebKit) and the V8 engine, utilizing a **Rust + QuickJS** stack to deliver a native application base with an extremely low memory footprint.

https://github.com/user-attachments/assets/4fc4edc7-d9d9-4b68-8060-32c76d53dd61

## 🎯 Purpose

**"JS only handles UI logic, everything else is delegated to Rust."**

In traditional Webview / Electron architectures, massive DOM trees and complex Browser APIs consume vast amounts of memory and introduce significant IPC overhead. The core objectives of this project are:

1. **DOM-less Reactive UI**: Uses `SolidJS` (via a custom `solid-js/universal` renderer) as the frontend reactive framework. Stripped of all real DOM and Web APIs (`window`, `document`), the JS side only maintains an ultra-lightweight component tree, utilizing signals to drive high-speed, fine-grained updates.
2. **Lightning-fast FFI Binary Communication**: Discards traditional JSON string serialization between JS and Rust. The JS layer packs UI mutation instructions (Opcodes) into compact binary `Uint8Array` frames and flushes them directly to Rust.
3. **Native Rust Rendering**: After receiving rendering instructions, the Rust side safely manages node lifecycles via a Generational Arena (completely preventing dangling pointers and cross-language memory leaks), and takes charge of the actual layout, style parsing, and graphics rendering.
4. **Extreme Minimalism**: The frontend includes a custom-built, ultra-lightweight native router (`@blitz-quick/solid-router`), removing all unnecessary web dependencies.

## 📦 Project Structure

This is a Monorepo workflow powered by Bun + Cargo:

- **`crates/blitz-quick/`**: Embeddable QuickJS + Blitz runtime library.
- **`crates/blitz-quick-desktop/`**: Desktop host, Vite HMR client, and screenshot renderer for the demo app.
- **`packages/protocol/`**: TypeScript definitions for Opcodes and EventCodes for JS-Rust communication (the Source of Truth).
- **`packages/core/`**: Low-level runtime shims (e.g., FFI bindings, patched implementations of `requestAnimationFrame` and timers).
- **`packages/solid-renderer/`**: The core custom SolidJS renderer. It intercepts SolidJS's `createElement` and similar methods, translating them into binary rendering instructions for Rust.
- **`packages/solid-router/`**: A handwritten, cross-platform native frontend router in under 50 lines of code, with zero DOM API dependencies.
- **`apps/demo/`**: The actual business logic demonstration. Uses Vite + UnoCSS to compile and bundle the `bundle.js` / `bundle.css` executed by QuickJS.

## 🚀 Getting Started

### Prerequisites

You need the following toolchains installed:
- **Rust / Cargo** (Latest stable version is fine)
- **Bun** (For lightning-fast frontend dependency installation and building)

### Running the Project

1. **Install Frontend Dependencies**:
   ```bash
   bun install
   ```

2. **Build Frontend Assets & Generate FFI Code**:
   This step executes codegen to translate the TS protocol into Rust enumerations, and uses Vite to build the UI JS bundle for the demo.
   ```bash
   bun run build
   ```

3. **Start the Rust Host Application**:
   ```bash
   cargo run -p blitz-quick-desktop
   ```

> **Development Mode (Hot Reloading)**:
> Run Vite and the desktop host in separate terminals:
>
> ```bash
> bun run dev
> cargo run -p blitz-quick-desktop -- --vite-url http://127.0.0.1:5173
> ```
>
> The desktop host loads Vite's transformed ESM modules into QuickJS and
> forwards Vite HMR updates to `solid-refresh`. Accepted component updates keep
> the QuickJS context and unaffected Solid parents alive. Updates that require
> Vite's `full-reload` fallback currently require restarting the desktop host.

### Desktop host options

Run an application from a distribution directory containing `bundle.js` and
`bundle.css`:

```bash
cargo run -p blitz-quick-desktop -- --dist-dir ./dist
```

JavaScript and CSS can also be selected independently:

```bash
cargo run -p blitz-quick-desktop -- --js ./dist/app.js --css ./dist/app.css
```

The Vite entry defaults to `/src/index.tsx` and can be overridden:

```bash
cargo run -p blitz-quick-desktop -- \
  --vite-url http://127.0.0.1:5173 \
  --vite-entry /src/main.tsx
```

For headless and visual tests, `--screenshot` accepts an optional output path.
The viewport, scale, and tick count are configurable:

```bash
cargo run -p blitz-quick-desktop -- \
  --dist-dir ./dist \
  --screenshot ./artifacts/frame.png \
  --width 1024 \
  --height 768 \
  --scale 1.5 \
  --ticks 3
```

## 🛠️ Quality & Standards

This project is configured with Biome for consistent frontend formatting and linting.
- **Format Code**: `bun run format`
- **TypeScript Type Check**: `bun run check`

## 🌟 Acknowledgments & Inspiration

This project was deeply inspired by [PocketJS](https://github.com/pocket-stack/pocketjs). Their pioneering work in Rust-based minimalistic UI rendering and architectural design significantly influenced the direction of Blitz-Quick.

## 🤖 AI-Generated Code & Contributions

**Disclaimer**: The vast majority of the code in this repository was generated by AI. The author comes from a Rust background with limited expertise in JavaScript/TypeScript ecosystems. 

We highly welcome and do not mind AI-generated Pull Requests! However, **please explicitly declare that you used AI** in your PR description. This helps maintain transparency and sets the right expectations during the review process.
