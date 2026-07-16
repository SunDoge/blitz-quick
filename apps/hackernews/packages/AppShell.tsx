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
    <div class="w-full h-screen overflow-hidden flex bg-[#0c0c0e] text-[#d4d4d8] font-sans select-none antialiased">
      <aside class="w-64 flex-none flex flex-col bg-[#16161a] border-r border-[#27272a] relative z-10">
        <div class="h-20 px-6 flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-[#ff6600] text-white font-serif text-lg font-bold">
            Y
          </div>
          <span class="text-base font-bold tracking-tight text-white">
            Hacker News
          </span>
        </div>

        <nav class="flex-1 px-3 py-4 flex flex-col gap-1" aria-label="Stories">
          <div
            class={`w-full h-11 px-3 flex items-center gap-3 border-0 rounded-lg text-left text-sm font-medium cursor-pointer transition-all duration-200 ${
              isFeed()
                ? "bg-[#27272a] text-white"
                : "bg-transparent text-[#a1a1aa] hover:bg-[#1f1f23] hover:text-[#d4d4d8]"
            }`}
            onClick={() => navigate("/")}
          >
            <Newspaper
              size={18}
              class={isFeed() ? "text-[#ff7b00]" : "opacity-80"}
            />
            <span>Top stories</span>
            <span
              class={`ml-auto text-xs px-2 py-0.5 rounded-full ${isFeed() ? "bg-black text-[#d4d4d8]" : "bg-transparent text-[#52525b]"}`}
            >
              {stories().length || ""}
            </span>
          </div>
        </nav>

        <div class="p-5 mt-auto">
          <div
            class="w-full h-10 px-4 flex items-center justify-center gap-2 border border-[#3f3f46] rounded-lg bg-[#1c1c22] hover:bg-[#25252d] text-[#d4d4d8] text-xs font-medium cursor-pointer transition-all active:scale-95"
            style={loading() ? "opacity: 0.5; pointer-events: none;" : ""}
            onClick={() => {
              if (!loading()) void loadStories();
            }}
          >
            <RefreshCw
              size={14}
              class={loading() ? "animate-spin text-[#ff7b00]" : ""}
            />
            <span>{loading() ? "Updating Feed..." : "Refresh Feed"}</span>
          </div>
          <div class="mt-5 flex items-center justify-center gap-2 text-[10px] text-[#52525b] uppercase tracking-widest font-semibold">
            <span class="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
            Blitz Desktop
          </div>
        </div>
      </aside>

      <main class="flex-1 min-w-0 min-h-0 overflow-hidden bg-[#0c0c0e]">
        {props.children}
      </main>
    </div>
  );
}
