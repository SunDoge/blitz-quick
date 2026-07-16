import { useNavigate } from "@solidjs/router";
import Bookmark from "lucide-solid/icons/bookmark";
import MessageSquare from "lucide-solid/icons/message-square";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { createMemo, For, type JSX, Show } from "solid-js";
import { LoadingList } from "../components/LoadingList";
import {
  activeView,
  isSaved,
  isVisited,
  loadError,
  loading,
  loadStories,
  markVisited,
  query,
  relativeTime,
  type Story,
  setQuery,
  storyHost,
  toggleSaved,
  viewLabels,
  visibleSource,
} from "../stories";

export function StoryList(): JSX.Element {
  const navigate = useNavigate();
  const visibleStories = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return visibleSource();
    return visibleSource().filter(
      (story) =>
        story.title.toLowerCase().includes(needle) ||
        story.by.toLowerCase().includes(needle) ||
        storyHost(story.url).includes(needle),
    );
  });

  const openStory = (story: Story) => {
    markVisited(story.id);
    navigate(`/story/${story.id}`);
  };

  return (
    <section class="h-full min-h-0 flex flex-col">
      <header class="h-18 flex-none px-7 flex items-center gap-6 border-b border-[var(--color-border)]">
        <div class="min-w-0 flex-1">
          <h1 class="m-0 text-xl font-semibold">{viewLabels[activeView()]}</h1>
          <p class="m-0 mt-1 text-[var(--color-text-muted)] text-xs">
            {activeView() === "saved"
              ? "Stories saved during this session"
              : "Live from the Hacker News API"}
          </p>
        </div>
        <label class="w-64 h-9 px-3 flex items-center gap-2 border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] focus-within:border-[var(--color-accent)]">
          <Search size={15} />
          <input
            class="w-full min-w-0 border-0 outline-none bg-transparent text-[var(--color-text)] text-sm"
            type="text"
            value={query()}
            placeholder="Search"
            aria-label="Filter stories"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <Show when={query()}>
            <X size={14} class="cursor-pointer" onClick={() => setQuery("")} />
          </Show>
        </label>
      </header>

      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 py-3">
        <Show
          when={!loading() || activeView() === "saved"}
          fallback={<LoadingList />}
        >
          <Show when={!loadError()} fallback={<LoadError />}>
            <Show when={visibleStories().length > 0} fallback={<EmptyState />}>
              <ol class="m-0 p-0 list-none">
                <For each={visibleStories()}>
                  {(story, index) => (
                    // biome-ignore lint/a11y/useSemanticElements: Blitz currently mislays out flex button elements.
                    <div
                      class={`h-18 px-3 flex items-center gap-4 border-b border-[var(--color-border-soft)] cursor-pointer hover:bg-[var(--color-hover)] ${
                        isVisited(story.id)
                          ? "text-[var(--color-text-muted)]"
                          : "text-[var(--color-text)]"
                      }`}
                      onClick={() => openStory(story)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          openStory(story);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span class="w-7 text-right text-[var(--color-text-muted)] font-mono text-xs">
                        {index() + 1}
                      </span>
                      <div class="flex-1 min-w-0">
                        <div class="leading-tight">
                          <strong class="text-sm font-medium">
                            {story.title}
                          </strong>
                          <Show when={story.url}>
                            <span class="text-[var(--color-text-muted)] text-xs whitespace-nowrap">
                              {" "}
                              ({storyHost(story.url)})
                            </span>
                          </Show>
                        </div>
                        <div class="mt-1.5 flex items-center gap-2 text-[var(--color-text-muted)] text-xs">
                          <span>{story.score} points</span>
                          <span>·</span>
                          <span>{story.by}</span>
                          <span>·</span>
                          <span>{relativeTime(story.time)}</span>
                        </div>
                      </div>
                      <span class="flex items-center gap-1 text-[var(--color-text-muted)] text-xs">
                        <MessageSquare size={13} />
                        {story.descendants ?? 0}
                      </span>
                      <BookmarkAction story={story} />
                    </div>
                  )}
                </For>
              </ol>
            </Show>
          </Show>
        </Show>
      </div>

      <footer class="h-9 flex-none px-7 flex items-center border-t border-[var(--color-border)] text-[var(--color-text-muted)] text-xs">
        {visibleStories().length} stories
      </footer>
    </section>
  );
}

function BookmarkAction(props: { story: Story }): JSX.Element {
  const toggle = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    toggleSaved(props.story);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: Nested native buttons are not laid out correctly by Blitz yet.
    <span
      class={
        isSaved(props.story.id)
          ? "text-[var(--color-accent)]"
          : "text-[var(--color-text-muted)]"
      }
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") toggle(event);
      }}
      role="button"
      tabIndex={0}
      title={isSaved(props.story.id) ? "Remove saved story" : "Save story"}
    >
      <Bookmark
        size={16}
        fill={isSaved(props.story.id) ? "currentColor" : "none"}
      />
    </span>
  );
}

function LoadError(): JSX.Element {
  return (
    <div class="min-h-80 flex flex-col items-center justify-center gap-3 text-[var(--color-text-muted)] text-center">
      <strong class="text-[var(--color-text)]">Could not load stories</strong>
      <span class="text-[var(--color-danger)] text-sm">{loadError()}</span>
      {/* biome-ignore lint/a11y/useSemanticElements: Blitz currently mislays out button elements. */}
      <span
        class="text-[var(--color-accent)] text-sm cursor-pointer"
        onClick={() => void loadStories(undefined, true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            void loadStories(undefined, true);
          }
        }}
        role="button"
        tabIndex={0}
      >
        Try again
      </span>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div class="min-h-80 flex flex-col items-center justify-center gap-2 text-[var(--color-text-muted)] text-center">
      <Bookmark size={22} />
      <strong class="text-[var(--color-text)]">
        {activeView() === "saved" ? "No saved stories" : "No matching stories"}
      </strong>
      <span class="text-sm">
        {activeView() === "saved"
          ? "Use the bookmark icon to keep a story here."
          : "Try another search."}
      </span>
    </div>
  );
}
