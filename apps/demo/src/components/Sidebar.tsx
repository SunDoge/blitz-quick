import type { Component, JSX } from "solid-js";
import { For } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";

/** A single sidebar tab. `icon` is a lucide component rendered at size 20. */
export interface Tab {
  /** Route path. The first tab should be "/". */
  path: string;
  /** Display label in the sidebar. */
  label: string;
  /** Lucide icon component. */
  icon: Component<{ size?: number }>;
  /** Page component rendered when this tab is active. */
  component: () => JSX.Element;
}

/** Sidebar nav built from a `tabs` array. Add a tab to the array (in
 * index.tsx) and both the sidebar and the route table pick it up — no other
 * edits needed. */
export function Sidebar(props: { tabs: Tab[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div class="w-64 bg-[#111827] flex flex-col border-r border-slate-800 shadow-2xl z-20">
      <div class="p-8 flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(34,211,238,0.4)]">
          B
        </div>
        <span class="text-2xl font-bold">Blitz.js</span>
      </div>

      <div class="flex-1 px-4 py-4 flex flex-col gap-2">
        <For each={props.tabs}>
          {(tab) => {
            const isActive = () => location.pathname === tab.path;
            const Icon = tab.icon;
            return (
              <div
                tabIndex={0}
                role="button"
                class={`px-4 py-3 rounded-xl font-medium cursor-pointer transition-colors duration-300 flex items-center gap-3 ${
                  isActive()
                    ? "bg-gradient-to-r from-cyan-500/20 to-blue-500/10 text-cyan-300 shadow-[inset_2px_0_0_rgba(34,211,238,1)]"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
                onClick={() => navigate(tab.path)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(tab.path);
                  }
                }}
              >
                <div class="text-lg">
                  <Icon size={20} />
                </div>
                {tab.label}
              </div>
            );
          }}
        </For>
      </div>

      <div class="p-6 border-t border-slate-800/50 bg-[#0B0F19]/30">
        <div class="text-xs text-slate-500 uppercase tracking-wider mb-1">
          Renderer
        </div>
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          <div class="text-sm font-semibold text-slate-300">Vello (GPU)</div>
        </div>
      </div>
    </div>
  );
}
