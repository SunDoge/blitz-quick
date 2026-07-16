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
    <div class="w-full h-screen overflow-hidden flex bg-[#eef0f2] text-[#20272e] font-sans select-none">
      <aside class="w-48 flex-none flex flex-col bg-[#20262d] text-[#d8dde2] border-r border-[#151a1f]">
        <button
          class="h-16 px-5 flex items-center gap-3 border-0 border-b border-[#303840] bg-transparent text-white text-left cursor-pointer"
          type="button"
          onClick={() => navigate("/")}
        >
          <span class="w-7 h-7 flex items-center justify-center bg-[#f26522] text-white font-serif text-base">
            Y
          </span>
          <span class="text-sm font-700">Hacker News</span>
        </button>

        <nav class="flex-1 p-2.5" aria-label="Stories">
          <button
            class={`w-full h-10 px-3 flex items-center gap-3 border-0 rounded text-left text-13px cursor-pointer ${
              isFeed()
                ? "bg-[#343c45] text-white"
                : "bg-transparent text-[#9da8b2]"
            }`}
            type="button"
            onClick={() => navigate("/")}
          >
            <Newspaper size={16} />
            <span>Top stories</span>
            <span class="ml-auto text-11px text-[#77838e]">
              {stories().length || ""}
            </span>
          </button>
        </nav>

        <div class="p-3 border-t border-[#303840]">
          <button
            class="w-full h-9 px-3 flex items-center gap-3 border-0 rounded bg-transparent text-[#9da8b2] text-xs text-left cursor-pointer disabled:opacity-55"
            type="button"
            disabled={loading()}
            onClick={() => void loadStories()}
          >
            <RefreshCw size={14} class={loading() ? "opacity-55" : ""} />
            <span>{loading() ? "Updating..." : "Refresh"}</span>
          </button>
          <div class="mt-2 px-3 flex items-center gap-2 text-10px text-[#6f7b85]">
            <span class="w-1.5 h-1.5 rounded-full bg-[#4eb47c]" />
            Rust data bridge
          </div>
        </div>
      </aside>

      <main class="flex-1 min-w-0 min-h-0 overflow-hidden bg-white">
        {props.children}
      </main>
    </div>
  );
}
