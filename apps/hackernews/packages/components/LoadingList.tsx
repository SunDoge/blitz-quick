import { For, type JSX } from "solid-js";

export function LoadingList(): JSX.Element {
  return (
    <div class="w-full">
      <For each={[1, 2, 3, 4, 5, 6]}>
        {(item) => (
          <div class="h-19.5 px-5.5 py-3.25 grid grid-cols-[38px_1fr] items-center gap-3 border-b border-[#edf0f1] text-[#c1c7cc] font-mono text-xs">
            <span>{String(item).padStart(2, "0")}</span>
            <div class="flex flex-col gap-2">
              <i class="block w-70% h-2.25 rounded-sm bg-[#e8ebed]" />
              <i class="block w-38% h-1.75 rounded-sm bg-[#e8ebed]" />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
