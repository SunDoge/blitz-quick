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
    <section class="h-full min-h-0 flex flex-col bg-white overflow-hidden">
      <div class="h-16 flex-none px-5 flex items-center gap-4 border-b border-[#dfe3e6] bg-[#f8f9fa]">
        <div class="min-w-0">
          <h1 class="m-0 text-[#20272e] text-base font-650 leading-tight">
            Top stories
          </h1>
          <p class="m-0 mt-1 text-[#87919a] text-11px">
            Ranked by the Hacker News community
          </p>
        </div>
        <label class="w-60 ml-auto h-8 px-2.5 flex items-center gap-2 border border-[#cbd1d6] rounded bg-white text-[#78838d] focus-within:border-[#8e9aa5]">
          <Search size={15} />
          <input
            class="w-full min-w-0 border-0 outline-none bg-transparent text-[#26323d] text-13px"
            type="text"
            value={query()}
            placeholder="Filter stories"
            aria-label="Filter stories"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <Show
          when={!loading() || stories().length > 0}
          fallback={<LoadingList />}
        >
          <Show when={!loadError()} fallback={<LoadError />}>
            <Show when={visibleStories().length > 0} fallback={<EmptyState />}>
              <ol class="m-0 p-0 list-none">
                <For each={visibleStories()}>
                  {(story, index) => (
                    <li class="h-18 px-4 grid grid-cols-[32px_minmax(0,1fr)_64px] items-center gap-3 border-b border-[#e9ecee] hover:bg-[#f7f8f9]">
                      <span class="text-[#a5adb4] font-mono text-xs">
                        {String(index() + 1).padStart(2, "0")}
                      </span>
                      <button
                        class="min-w-0 p-0 border-0 bg-transparent text-left cursor-pointer"
                        type="button"
                        onClick={() => navigate(`/story/${story.id}`)}
                      >
                        <span class="min-w-0 flex items-baseline gap-2">
                          <strong class="min-w-0 overflow-hidden text-[#20272e] text-13px font-600 leading-snug text-ellipsis whitespace-nowrap">
                            {story.title}
                          </strong>
                          <span class="lt-md:hidden flex-none text-[#8b959e] text-11px">
                            {storyHost(story.url)}
                          </span>
                        </span>
                        <span class="mt-1.5 flex gap-3.5 text-[#7c8790] text-11px">
                          <span>{story.score} points</span>
                          <span>by {story.by}</span>
                          <span>{relativeTime(story.time)}</span>
                        </span>
                      </button>
                      <button
                        class="lt-md:hidden p-0 border-0 bg-transparent text-left cursor-pointer flex flex-col items-end text-[#8a949d] text-10px"
                        type="button"
                        onClick={() => navigate(`/story/${story.id}`)}
                      >
                        <strong class="text-[#44515c] text-15px">
                          {story.descendants ?? 0}
                        </strong>
                        <span>comments</span>
                      </button>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </Show>
        </Show>
      </div>

      <footer class="h-8 flex-none px-4 flex items-center justify-between border-t border-[#dfe3e6] bg-[#f5f6f7] text-[#7f8992] text-10px">
        <span>{visibleStories().length} stories</span>
        <span>Updated from Hacker News API</span>
      </footer>
    </section>
  );
}

function LoadError(): JSX.Element {
  return (
    <div class="min-h-85 p-10 flex flex-col items-center justify-center gap-2 text-[#7c8790] text-center">
      <strong class="text-[#26323d]">Stories could not be loaded</strong>
      <span class="text-[#b34b3e]">{loadError()}</span>
      <button
        class="mt-3 px-3.5 py-2 border border-[#cbd1d6] rounded bg-white cursor-pointer"
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
    <div class="min-h-85 p-10 flex flex-col items-center justify-center gap-2 text-[#7c8790] text-center">
      <strong class="text-[#26323d]">No matching stories</strong>
      <span>Try a different title, author, or domain.</span>
    </div>
  );
}
