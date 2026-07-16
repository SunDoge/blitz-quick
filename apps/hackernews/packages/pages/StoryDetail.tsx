import { useNavigate, useParams } from "@solidjs/router";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import Bookmark from "lucide-solid/icons/bookmark";
import ExternalLink from "lucide-solid/icons/external-link";
import { createMemo, type JSX, Show } from "solid-js";
import {
  isSaved,
  relativeTime,
  savedStories,
  stories,
  storyHost,
  toggleSaved,
} from "../stories";

export function StoryDetail(): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const story = createMemo(() =>
    [...stories(), ...savedStories()].find(
      (item) => item.id === Number(params.id),
    ),
  );
  const goBack = () => navigate(-1);

  return (
    <section class="h-full min-h-0 flex flex-col bg-[var(--color-bg)]">
      <header class="h-14 flex-none px-6 flex items-center border-b border-[var(--color-border)]">
        {/* biome-ignore lint/a11y/useSemanticElements: Blitz currently mislays out flex button elements. */}
        <div
          class="h-8 px-3 flex items-center gap-2 rounded-md bg-[var(--color-surface)] text-[var(--color-text-secondary)] text-xs cursor-pointer"
          onClick={goBack}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") goBack();
          }}
          role="button"
          tabIndex={0}
        >
          <ArrowLeft size={14} />
          Back
        </div>
      </header>

      <Show when={story()} fallback={<MissingStory />}>
        {(current) => (
          <article class="flex-1 min-h-0 overflow-y-auto px-10 py-9">
            <div class="max-w-3xl mx-auto">
              <p class="m-0 mb-3 text-[var(--color-accent)] text-xs font-semibold">
                {storyHost(current().url)}
              </p>
              <h1 class="m-0 text-[var(--color-text)] text-3xl font-semibold leading-tight">
                {current().title}
              </h1>
              <div class="mt-5 flex gap-3 text-[var(--color-text-muted)] text-sm">
                <span>{current().score} points</span>
                <span>·</span>
                <span>{current().by}</span>
                <span>·</span>
                <span>{relativeTime(current().time)}</span>
              </div>

              <div class="mt-9 flex gap-3">
                <Show when={current().url}>
                  <a
                    class="h-9 px-4 flex items-center gap-2 rounded-md bg-[var(--color-accent)] text-white text-sm font-medium no-underline"
                    href={current().url}
                  >
                    Open article <ExternalLink size={14} />
                  </a>
                </Show>
                <a
                  class="h-9 px-4 flex items-center rounded-md bg-[var(--color-surface)] text-[var(--color-text-secondary)] text-sm no-underline"
                  href={`https://news.ycombinator.com/item?id=${current().id}`}
                >
                  {current().descendants ?? 0} comments
                </a>
                {/* biome-ignore lint/a11y/useSemanticElements: Blitz currently mislays out flex button elements. */}
                <div
                  class={`h-9 px-3 flex items-center gap-2 rounded-md cursor-pointer ${
                    isSaved(current().id)
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
                  }`}
                  onClick={() => toggleSaved(current())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      toggleSaved(current());
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <Bookmark
                    size={14}
                    fill={isSaved(current().id) ? "currentColor" : "none"}
                  />
                  <span class="text-sm">
                    {isSaved(current().id) ? "Saved" : "Save"}
                  </span>
                </div>
              </div>

              <div class="mt-12 pt-5 border-t border-[var(--color-border)] text-[var(--color-text-muted)] text-xs">
                Story data fetched by Rust and rendered with Solid
              </div>
            </div>
          </article>
        )}
      </Show>
    </section>
  );
}

function MissingStory(): JSX.Element {
  return (
    <div class="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--color-text-muted)]">
      <strong class="text-[var(--color-text)]">Story not found</strong>
      <span class="text-sm">Return to the feed and choose another story.</span>
    </div>
  );
}
