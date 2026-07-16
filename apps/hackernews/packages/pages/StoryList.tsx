import { useNavigate } from "@solidjs/router";
import Search from "lucide-solid/icons/search";
import { createMemo, For, type JSX, Show } from "solid-js";
import { LoadingList } from "../components/LoadingList";
import {
  loadError,
  loading,
  loadStories,
  query,
  relativeTime,
  setQuery,
  stories,
  storyHost,
} from "../stories";

export function StoryList(): JSX.Element {
  const navigate = useNavigate();
  const visibleStories = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return stories();
    return stories().filter(
      (story) =>
        story.title.toLowerCase().includes(needle) ||
        story.by.toLowerCase().includes(needle) ||
        storyHost(story.url).includes(needle),
    );
  });

  return (
    <section class="h-full min-h-0 flex flex-col relative z-10">
      <div class="h-20 flex-none px-8 flex items-center gap-6 border-b border-white/5 bg-[#0c0c0e]/80 backdrop-blur-md">
        <div class="min-w-0 flex-1">
          <h1 class="m-0 text-zinc-100 text-xl font-bold tracking-tight">
            Top stories
          </h1>
          <p class="m-0 mt-1 text-zinc-500 text-xs font-medium">
            Ranked by the Hacker News community
          </p>
        </div>
        <label class="w-72 h-9 px-3.5 flex items-center gap-2.5 border border-white/10 rounded-lg bg-white/5 text-zinc-400 focus-within:ring-2 focus-within:ring-[#ff7b00]/30 focus-within:border-[#ff7b00]/50 transition-all shadow-inner">
          <Search size={15} />
          <input
            class="w-full min-w-0 border-0 outline-none bg-transparent text-zinc-200 text-sm placeholder-zinc-500"
            type="text"
            value={query()}
            placeholder="Search stories..."
            aria-label="Filter stories"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4">
        <Show
          when={!loading() || stories().length > 0}
          fallback={<LoadingList />}
        >
          <Show when={!loadError()} fallback={<LoadError />}>
            <Show when={visibleStories().length > 0} fallback={<EmptyState />}>
              <ol class="m-0 p-0 list-none space-y-1.5">
                <For each={visibleStories()}>
                  {(story, index) => (
                    <li
                      class="group px-4 py-3.5 flex items-center gap-4 rounded-xl border border-transparent hover:border-white/5 hover:bg-white/[0.03] active:scale-[0.99] transition-all cursor-pointer"
                      onClick={() => navigate(`/story/${story.id}`)}
                    >
                      <span class="w-6 text-right text-zinc-600 font-mono text-xs font-bold opacity-70 group-hover:opacity-100 group-hover:text-[#ff7b00] transition-colors">
                        {String(index() + 1).padStart(2, "0")}
                      </span>
                      <div class="flex-1 min-w-0 flex flex-col gap-1.5">
                        <div class="flex items-baseline gap-3">
                          <strong class="text-zinc-300 text-sm font-semibold leading-tight group-hover:text-white transition-colors truncate">
                            {story.title}
                          </strong>
                          <span class="lt-md:hidden text-zinc-500 text-xs font-medium truncate flex-shrink">
                            {storyHost(story.url)}
                          </span>
                        </div>
                        <div class="flex items-center gap-3 text-zinc-500 text-xs font-medium">
                          <span class="flex items-center gap-1.5 text-zinc-400">
                            <span class="w-1.5 h-1.5 rounded-full bg-[#ff7b00]/80" />
                            {story.score} pts
                          </span>
                          <span class="text-zinc-700">•</span>
                          <span>
                            by <span class="text-zinc-400">{story.by}</span>
                          </span>
                          <span class="text-zinc-700">•</span>
                          <span>{relativeTime(story.time)}</span>
                        </div>
                      </div>
                      <div class="lt-md:hidden flex-none flex flex-col items-end justify-center">
                        <div class="px-2.5 py-1.5 rounded-lg bg-transparent group-hover:bg-[#ff7b00]/10 border border-transparent group-hover:border-[#ff7b00]/20 transition-colors flex items-center gap-1.5">
                          <strong class="text-zinc-500 group-hover:text-[#ff7b00] text-xs transition-colors">
                            {story.descendants ?? 0}
                          </strong>
                          <span class="text-zinc-600 group-hover:text-[#ff7b00]/70 text-xs transition-colors">
                            💬
                          </span>
                        </div>
                      </div>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </Show>
        </Show>
      </div>

      <footer class="h-10 flex-none px-6 flex items-center justify-between border-t border-white/5 bg-[#0a0a0c] text-zinc-600 text-xs font-medium">
        <span>{visibleStories().length} stories matched</span>
        <span>Live from Hacker News API</span>
      </footer>
    </section>
  );
}

function LoadError(): JSX.Element {
  return (
    <div class="min-h-85 p-10 flex flex-col items-center justify-center gap-3 text-zinc-500 text-center">
      <strong class="text-zinc-300 text-lg">Failed to load stories</strong>
      <span class="text-red-400/80 text-sm">{loadError()}</span>
      <button
        class="mt-4 px-4 py-2 border border-white/10 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium cursor-pointer transition-all active:scale-95"
        type="button"
        onClick={() => void loadStories()}
      >
        Try again
      </button>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div class="min-h-85 p-10 flex flex-col items-center justify-center gap-2 text-zinc-500 text-center">
      <strong class="text-zinc-300 text-lg">No matching stories</strong>
      <span class="text-sm">Try a different title, author, or domain.</span>
    </div>
  );
}
