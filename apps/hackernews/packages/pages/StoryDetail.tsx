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
    <section class="h-full min-h-0 flex flex-col bg-white overflow-hidden">
      <div class="h-13 flex-none px-4 flex items-center border-b border-[#dfe3e6] bg-[#f8f9fa]">
        <button
          class="h-8 px-2.5 flex items-center gap-2 border border-[#ccd2d7] rounded bg-white text-[#56616b] text-xs cursor-pointer"
          type="button"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={14} />
          Stories
        </button>
        <span class="ml-4 text-xs text-[#929ba3]">Story details</span>
      </div>
      <Show when={story()} fallback={<MissingStory />}>
        {(current) => (
          <article class="flex-1 min-h-0 overflow-y-auto px-8 py-7">
            <p class="m-0 mb-1 text-[#d95316] text-11px font-700 uppercase">
              {storyHost(current().url)}
            </p>
            <h1 class="m-0 max-w-175 text-[#20272e] text-2xl font-650 leading-tight">
              {current().title}
            </h1>
            <div class="mt-4.5 flex lt-md:flex-col lt-md:items-start gap-4.5 text-[#7c8790] text-xs">
              <span>
                <strong class="text-[#45515c]">{current().score}</strong> points
              </span>
              <span>
                submitted by{" "}
                <strong class="text-[#45515c]">{current().by}</strong>
              </span>
              <span>{relativeTime(current().time)}</span>
            </div>
            <div class="mt-8.5 flex lt-md:flex-col lt-md:items-start gap-2.5">
              <Show when={current().url}>
                <a
                  class="px-3.5 py-2.5 flex items-center gap-2 rounded bg-[#e85b1a] text-white text-xs font-600 no-underline"
                  href={current().url}
                >
                  Read original article <ExternalLink size={13} />
                </a>
              </Show>
              <a
                class="px-3.5 py-2.5 border border-[#ccd2d7] rounded bg-white text-[#46535e] text-xs font-600 no-underline"
                href={`https://news.ycombinator.com/item?id=${current().id}`}
              >
                {current().descendants ?? 0} comments on Hacker News
              </a>
            </div>
            <div class="max-w-175 mt-10 pt-4 flex items-center gap-2 border-t border-[#e7eaec] text-[#8a949d] text-11px">
              <span class="w-1.75 h-1.75 rounded-full bg-[#37a66b]" />
              Story data fetched asynchronously by Rust and rendered in Solid
            </div>
          </article>
        )}
      </Show>
    </section>
  );
}

function MissingStory(): JSX.Element {
  return (
    <div class="min-h-85 p-10 flex flex-col items-center justify-center gap-2 text-[#7c8790] text-center">
      <strong class="text-[#26323d]">Story not found</strong>
      <span>Return to the feed and select another story.</span>
    </div>
  );
}
