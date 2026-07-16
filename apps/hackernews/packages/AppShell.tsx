import type { JSX } from "solid-js";
import { Sidebar } from "./components/Sidebar";

export function AppShell(props: { children?: JSX.Element }): JSX.Element {
  return (
    <div class="w-full h-screen overflow-hidden flex bg-[var(--color-bg)] text-[var(--color-text)] font-sans select-none antialiased">
      <Sidebar />

      <main class="flex-1 min-w-0 min-h-0 overflow-hidden bg-[var(--color-bg)]">
        {props.children}
      </main>
    </div>
  );
}
