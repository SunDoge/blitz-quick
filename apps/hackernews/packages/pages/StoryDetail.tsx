import { useNavigate, useParams } from "@solidjs/router";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import ExternalLink from "lucide-solid/icons/external-link";
import { createMemo, type JSX, Show } from "solid-js";
import { relativeTime, stories, storyHost } from "../stories";

export function StoryDetail(): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const story = createMemo(() =>
    stories().find((item) => item.id === Number(params.id)),
  );

  return (
    <section class="h-full min-h-0 flex flex-col relative z-10">
      <div class="h-16 flex-none px-6 flex items-center border-b border-[#27272a] bg-[#0c0c0e]">
        <div
          class="h-8 px-3 flex items-center gap-2 border border-[#3f3f46] rounded-lg bg-[#18181b] hover:bg-[#27272a] text-[#d4d4d8] text-xs font-medium cursor-pointer transition-all active:scale-95"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={14} />
          Back to feed
        </div>
        <span class="ml-4 text-xs font-medium text-[#71717a]">
          Story details
        </span>
      </div>
      <Show when={story()} fallback={<MissingStory />}>
        {(current) => (
          <article class="flex-1 min-h-0 overflow-y-auto px-10 py-10">
            <div class="max-w-3xl mx-auto">
              <p class="m-0 mb-3 text-[#ff7b00] text-xs font-bold uppercase tracking-wider">
                {storyHost(current().url)}
              </p>
              <h1 class="m-0 text-[#f4f4f5] text-3xl font-bold leading-tight tracking-tight">
                {current().title}
              </h1>
              <div class="mt-6 flex lt-md:flex-col lt-md:items-start gap-4 text-[#71717a] text-sm font-medium">
                <span class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#ff7b00]" />
                  <strong class="text-[#d4d4d8] font-semibold">
                    {current().score}
                  </strong>{" "}
                  points
                </span>
                <span class="lt-md:hidden text-[#3f3f46]">•</span>
                <span>
                  by{" "}
                  <strong class="text-[#d4d4d8] font-semibold">
                    {current().by}
                  </strong>
                </span>
                <span class="lt-md:hidden text-[#3f3f46]">•</span>
                <span>{relativeTime(current().time)}</span>
              </div>
              <div class="mt-10 flex lt-md:flex-col lt-md:items-start gap-3">
                <Show when={current().url}>
                  <a
                    class="px-5 py-2.5 flex items-center justify-center gap-2 rounded-xl bg-[#ff6600] hover:bg-[#ff7b00] text-white text-sm font-semibold no-underline transition-all active:scale-95"
                    href={current().url}
                  >
                    Read article <ExternalLink size={14} />
                  </a>
                </Show>
                <a
                  class="px-5 py-2.5 flex items-center justify-center gap-2 border border-[#3f3f46] rounded-xl bg-[#18181b] hover:bg-[#27272a] text-[#d4d4d8] text-sm font-semibold no-underline transition-all active:scale-95"
                  href={`https://news.ycombinator.com/item?id=${current().id}`}
                >
                  {current().descendants ?? 0} comments on HN
                </a>
              </div>
              <div class="mt-14 pt-6 flex items-center gap-2.5 border-t border-[#27272a] text-[#52525b] text-xs font-medium">
                <span class="w-2 h-2 rounded-full bg-[#10b981]" />
                Data bridged instantly from Rust
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
    <div class="min-h-85 p-10 flex flex-col items-center justify-center gap-2 text-[#71717a] text-center">
      <strong class="text-[#d4d4d8] text-lg">Story not found</strong>
      <span class="text-sm">Return to the feed and select another story.</span>
    </div>
  );
}
