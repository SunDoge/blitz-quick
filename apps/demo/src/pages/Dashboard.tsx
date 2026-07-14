import { Activity, Server, Zap } from "lucide-solid";
import { createSignal, For } from "solid-js";

export function Dashboard(props: { sysData: string }) {
  const [count, setCount] = createSignal(0);
  let os = "Unknown",
    arch = "Unknown",
    cpus = 0,
    mem = 0;
  try {
    if (props.sysData.startsWith("{")) {
      const data = JSON.parse(props.sysData);
      os = data.os;
      arch = data.arch;
      cpus = data.cpus;
      mem = data.memory_gb;
    }
  } catch {}

  return (
    <div class="flex-1 flex flex-col gap-8 h-full">
      <div class="flex gap-8 h-[45%]">
        <div class="flex-1 bg-slate-800/40 rounded-3xl p-8 border border-slate-700/50 shadow-xl flex flex-col relative overflow-hidden group">
          <div class="absolute -right-10 -top-10 w-40 h-40 bg-cyan-500/10 rounded-full transition-transform group-hover:scale-150 duration-700" />
          <h2 class="text-sm text-cyan-400 font-bold tracking-widest uppercase mb-6 flex items-center gap-2">
            <Server size={18} /> System Host (Rust FFI)
          </h2>
          <div class="flex-1 flex flex-col justify-center gap-6">
            <div class="flex justify-between items-end border-b border-slate-700/50 pb-3">
              <div class="text-slate-400 font-medium text-lg">OS</div>
              <div class="text-xl text-white font-mono">
                {os} / {arch}
              </div>
            </div>
            <div class="flex justify-between items-end border-b border-slate-700/50 pb-3">
              <div class="text-slate-400 font-medium text-lg">CPU Cores</div>
              <div class="text-xl text-white font-mono">{cpus} Logical</div>
            </div>
            <div class="flex justify-between items-end">
              <div class="text-slate-400 font-medium text-lg">
                System Memory
              </div>
              <div class="text-xl text-white font-mono">{mem} GB</div>
            </div>
          </div>
        </div>

        <div class="flex-1 bg-gradient-to-br from-indigo-900/40 to-purple-900/20 rounded-3xl p-8 border border-indigo-500/20 shadow-xl flex flex-col items-center justify-center relative overflow-hidden group">
          <h2 class="absolute top-8 left-8 text-sm text-indigo-300 font-bold tracking-widest uppercase flex items-center gap-2">
            <Zap size={18} /> SolidJS Reactivity
          </h2>
          <div class="text-7xl font-bold text-white mb-8 font-mono drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]">
            {count()}
          </div>
          <div class="flex gap-4">
            <button
              type="button"
              class="px-8 py-3 bg-indigo-500 text-white rounded-xl font-bold hover:bg-indigo-400 transition-colors shadow-lg active:scale-95"
              onClick={() => setCount((value) => value - 1)}
            >
              DECREASE
            </button>
            <button
              type="button"
              class="px-8 py-3 bg-cyan-500 text-white rounded-xl font-bold hover:bg-cyan-400 transition-colors shadow-lg active:scale-95"
              onClick={() => setCount((value) => value + 1)}
            >
              INCREASE
            </button>
          </div>
        </div>
      </div>
      <div class="flex gap-8 h-[55%]">
        <div class="flex-[2] bg-slate-800/40 rounded-3xl p-8 border border-slate-700/50 shadow-xl flex flex-col">
          <h2 class="text-sm text-slate-400 font-bold tracking-widest uppercase mb-6 flex items-center gap-2">
            <Activity size={18} /> Activity Timeline
          </h2>
          <div class="flex-1 flex items-end justify-between gap-3 pt-4">
            <For each={[30, 50, 20, 80, 60, 40, 90, 70, 50, 85, 45, 65]}>
              {(height) => (
                <div
                  class="w-full bg-slate-700 rounded-t-sm relative group hover:bg-cyan-500 transition-colors"
                  style={`height: ${height}%`}
                />
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
