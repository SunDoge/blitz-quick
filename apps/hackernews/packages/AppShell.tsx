import { useLocation, useNavigate } from "@solidjs/router";
import Newspaper from "lucide-solid/icons/newspaper";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { type JSX, onMount } from "solid-js";
import { loadStories, loading, stories } from "./stories";

export function AppShell(props: { children?: JSX.Element }): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const isFeed = () => location.pathname === "/";

  onMount(() => {
    if (stories().length === 0) void loadStories();
  });

  return (
    <div class="w-full h-screen overflow-hidden flex bg-[#0c0c0e] text-zinc-300 font-sans select-none antialiased">
      <aside class="w-64 flex-none flex flex-col bg-[#16161a] border-r border-white/5 relative z-10 shadow-2xl">
        <div class="h-20 px-6 flex items-center gap-3 border-b border-transparent">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#ff6600] to-[#ff9900] text-white font-serif text-lg font-bold shadow-[0_0_15px_rgba(255,102,0,0.3)]">
            Y
          </div>
          <span class="text-base font-bold tracking-tight text-white/90">
            Hacker News
          </span>
        </div>

        <nav class="flex-1 px-3 py-4 space-y-1" aria-label="Stories">
          <button
            class={`w-full h-11 px-3 flex items-center gap-3 border-0 rounded-xl text-left text-sm font-medium cursor-pointer transition-all duration-200 ${
              isFeed()
                ? "bg-white/10 text-white shadow-sm ring-1 ring-white/5"
                : "bg-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
            type="button"
            onClick={() => navigate("/")}
          >
            <Newspaper
              size={18}
              class={isFeed() ? "text-[#ff7b00]" : "opacity-80"}
            />
            <span>Top stories</span>
            <span
              class={`ml-auto text-xs px-2 py-0.5 rounded-full ${isFeed() ? "bg-black/40 text-white/80" : "bg-transparent text-zinc-600"}`}
            >
              {stories().length || ""}
            </span>
          </button>
        </nav>

        <div class="p-5 mt-auto">
          <button
            class="w-full h-10 px-4 flex items-center justify-center gap-2 border border-white/5 rounded-xl bg-[#1c1c22] hover:bg-[#25252d] text-zinc-300 text-xs font-medium cursor-pointer transition-all disabled:opacity-50 active:scale-95 shadow-sm"
            type="button"
            disabled={loading()}
            onClick={() => void loadStories()}
          >
            <RefreshCw
              size={14}
              class={loading() ? "animate-spin text-[#ff7b00]" : ""}
            />
            <span>{loading() ? "Updating Feed..." : "Refresh Feed"}</span>
          </button>
          <div class="mt-5 flex items-center justify-center gap-2 text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
            Blitz Desktop
          </div>
        </div>
      </aside>

      <main class="flex-1 min-w-0 min-h-0 overflow-hidden bg-[#0c0c0e] relative">
        <div class="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
        {props.children}
      </main>
    </div>
  );
}
