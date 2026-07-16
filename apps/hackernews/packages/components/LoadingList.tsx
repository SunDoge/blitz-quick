import { For, type JSX } from "solid-js";

export function LoadingList(): JSX.Element {
  return (
    <div class="w-full">
      <For each={[1, 2, 3, 4, 5, 6]}>
        {(item) => (
          <div class="h-18 px-3 flex items-center gap-4 border-b border-[var(--color-border-soft)]">
            <span class="w-7 text-right text-[var(--color-text-muted)] font-mono text-xs">
              {item}
            </span>
            <div class="flex-1 flex flex-col gap-2">
              <i class="block w-70% h-2 rounded-sm bg-[var(--color-skeleton)]" />
              <i class="block w-38% h-1.5 rounded-sm bg-[var(--color-skeleton)]" />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
