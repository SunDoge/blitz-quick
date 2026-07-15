import ScrollText from "lucide-solid/icons/scroll-text";
import { For } from "solid-js";

export function Logs() {
  const levels: [string, string][] = [
    ["INFO", "text-cyan-400"],
    ["WARN", "text-amber-400"],
    ["ERROR", "text-rose-400"],
    ["DEBUG", "text-slate-500"],
  ];
  const messages = [
    "renderer initialized (vello-cpu)",
    "font collection loaded 2622 families",
    "style traversal completed in 1.2ms",
    "layout pass: 48 nodes",
    "paint scene pushed 12 clips",
    "rAF tick scheduled",
    "dom mutation: 3 ops applied",
    "event driver: pointermove dispatched",
    "scroll container reflowed",
    "glyph cache hit ratio 0.94",
  ];
  const lines = Array.from({ length: 60 }, (_, index) => {
    const level = levels[index % levels.length];
    const message = messages[index % messages.length];
    const timestamp = `0${Math.floor(index / 60)}:${String(index % 60).padStart(2, "0")}:${String(
      (index * 137) % 1000,
    ).padStart(3, "0")}`;
    return { index, timestamp, level, message };
  });

  return (
    <div class="flex-1 min-h-0 flex flex-col bg-slate-800/40 rounded-3xl p-8 border border-slate-700/50 shadow-xl">
      <h2 class="text-sm text-cyan-400 font-bold tracking-widest uppercase mb-6 flex items-center gap-2">
        <ScrollText size={18} /> Scrollable Log Stream
      </h2>
      <div
        id="logs-scroll"
        class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-[#0B0F19] rounded-2xl p-4 border border-slate-800 font-mono text-sm leading-relaxed shadow-inner"
      >
        <For each={lines}>
          {(line) => (
            <div class="flex gap-3 py-1 border-b border-slate-800/50 hover:bg-slate-800/40">
              <span class="text-slate-600 shrink-0">{line.timestamp}</span>
              <span class={`shrink-0 w-12 font-bold ${line.level[1]}`}>
                {line.level[0]}
              </span>
              <span class="text-slate-300">
                [node#{line.index}] {line.message}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
