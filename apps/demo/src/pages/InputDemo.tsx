import { Keyboard } from "lucide-solid";
import { createSignal } from "solid-js";

export function InputDemo() {
  const [text, setText] = createSignal("");

  return (
    <div class="flex-1 flex flex-col bg-slate-800/40 rounded-3xl p-8 border border-slate-700/50 shadow-xl items-center justify-center relative overflow-y-auto">
      <h2 class="absolute top-8 left-8 text-sm text-pink-400 font-bold tracking-widest uppercase flex items-center gap-2">
        <Keyboard size={18} /> Text Input Demo
      </h2>
      <div class="flex flex-col items-center gap-6 w-full max-w-lg mt-12">
        <div class="w-full">
          <div class="text-slate-400 mb-2 font-semibold">Native Widget:</div>
          <input
            type="text"
            value={text()}
            onInput={(event) => setText(event.currentTarget.value)}
            placeholder="Type something here..."
            class="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-pink-500 focus:shadow-[0_0_8px_rgba(236,72,153,0.5)] transition-all"
          />
        </div>
        <div class="text-slate-400 font-mono bg-[#0B0F19] w-full p-6 rounded-2xl border border-slate-800 shadow-inner break-all min-h-24">
          <div class="text-slate-500 mb-2">Output Preview:</div>
          <span class="text-pink-400 text-lg">{text()}</span>
        </div>
      </div>
    </div>
  );
}
