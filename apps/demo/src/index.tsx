import { type Handle, registerRoot, render } from "@blitz-quick/solid-renderer";
import {
  NativeRoute,
  NativeRouter,
  useLocation,
  useNavigate,
} from "@blitz-quick/solid-router";
import {
  Activity,
  Globe,
  LayoutDashboard,
  Server,
  Settings,
  Zap,
} from "lucide-solid";
import { createSignal, For, type JSX, onMount, Show } from "solid-js";

import "@blitz-quick/core";

// Root mount handle (id 1) — Rust hands this in as the #root node.
const ROOT: Handle = {
  id: 1,
  tag: "#root",
  parent: null,
  firstChild: null,
  lastChild: null,
  prev: null,
  next: null,
};

const [fps, setFps] = createSignal(0);
const [sysData, setSysData] = createSignal("Loading OS Data...");

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = ["Dashboard", "Network", "Settings"];

  return (
    <div class="w-64 bg-[#111827] flex flex-col border-r border-slate-800 shadow-2xl z-20">
      <div class="p-8 flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(34,211,238,0.4)]">
          B
        </div>
        <span class="text-2xl font-bold">Blitz.js</span>
      </div>

      <div class="flex-1 px-4 py-4 flex flex-col gap-2">
        <For each={tabs}>
          {(tab) => {
            const tabPath = tab === "Dashboard" ? "/" : `/${tab.toLowerCase()}`;
            const isActive = () => location.pathname === tabPath;
            return (
              <div
                class={`px-4 py-3 rounded-xl font-medium cursor-pointer transition-colors duration-300 flex items-center gap-3 ${
                  isActive()
                    ? "bg-gradient-to-r from-cyan-500/20 to-blue-500/10 text-cyan-300 shadow-[inset_2px_0_0_rgba(34,211,238,1)]"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
                onClick={() => navigate(tabPath)}
              >
                <div class="text-lg">
                  <Show when={tab === "Dashboard"}>
                    <LayoutDashboard size={20} />
                  </Show>
                  <Show when={tab === "Network"}>
                    <Globe size={20} />
                  </Show>
                  <Show when={tab === "Settings"}>
                    <Settings size={20} />
                  </Show>
                </div>
                {tab}
              </div>
            );
          }}
        </For>
      </div>

      <div class="p-6 border-t border-slate-800/50 bg-[#0B0F19]/30">
        <div class="text-xs text-slate-500 uppercase tracking-wider mb-1">
          Renderer
        </div>
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          <div class="text-sm font-semibold text-slate-300">Vello (GPU)</div>
        </div>
      </div>
    </div>
  );
}

function Header() {
  const location = useLocation();
  const title = () => {
    const p = location.pathname;
    if (p === "/") return "Dashboard";
    return p.slice(1).charAt(0).toUpperCase() + p.slice(2);
  };
  return (
    <div class="h-20 flex items-center justify-between px-10 border-b border-slate-800/50 z-10 bg-[#0B0F19]/50">
      <h1 class="text-2xl font-semibold text-white tracking-tight">
        {title()}
      </h1>
      <div class="flex items-center gap-3 bg-slate-800/60 px-4 py-2 rounded-full border border-slate-700 shadow-inner">
        <div class="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
        <div class="text-sm font-mono font-bold text-emerald-400 tracking-widest">
          {fps()} FPS
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const [count, setCount] = createSignal(0);
  let os = "Unknown",
    arch = "Unknown",
    cpus = 0,
    mem = 0;
  try {
    if (sysData().startsWith("{")) {
      const d = JSON.parse(sysData());
      os = d.os;
      arch = d.arch;
      cpus = d.cpus;
      mem = d.memory_gb;
    }
  } catch (e) {}

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
              <div class="text-slate-400 font-medium text-lg">
                OS Architecture
              </div>
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
              class="px-8 py-3 bg-indigo-500 text-white rounded-xl font-bold hover:bg-indigo-400 transition-colors shadow-lg active:scale-95"
              onClick={() => setCount((c) => c - 1)}
            >
              DECREASE
            </button>
            <button
              class="px-8 py-3 bg-cyan-500 text-white rounded-xl font-bold hover:bg-cyan-400 transition-colors shadow-lg active:scale-95"
              onClick={() => setCount((c) => c + 1)}
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
                ></div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}

function Network() {
  const [networkLog, setNetworkLog] = createSignal("Idle.");
  const [isFetching, setIsFetching] = createSignal(false);
  const runNetworkTest = async () => {
    setIsFetching(true);
    setNetworkLog("Fetching data from dummyjson.com...");
    try {
      const res = await fetch("https://dummyjson.com/products/1");
      const data = await res.json();
      setNetworkLog(
        `Success! \n\nProduct: ${data.title}\nPrice: $${data.price}\nCategory: ${data.category}\n\nDescription: ${data.description}`,
      );
    } catch (err) {
      setNetworkLog(`Error: ${String(err)}`);
    } finally {
      setIsFetching(false);
    }
  };
  return (
    <div class="flex-1 flex flex-col bg-slate-800/40 rounded-3xl p-8 border border-slate-700/50 shadow-xl">
      <div class="flex items-center justify-between mb-8">
        <h2 class="text-sm text-cyan-400 font-bold tracking-widest uppercase flex items-center gap-2">
          <Globe size={18} /> Tokio Fetch Bridge
        </h2>
        <button
          class={`px-8 py-3 rounded-xl font-bold transition-colors shadow-lg active:scale-95 ${isFetching() ? "bg-slate-600 text-slate-300" : "bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-white"}`}
          onClick={runNetworkTest}
        >
          {isFetching() ? "FETCHING..." : "TEST FETCH"}
        </button>
      </div>
      <div class="flex-1 bg-[#0B0F19] rounded-2xl p-6 border border-slate-800 font-mono text-base text-emerald-400 overflow-hidden whitespace-pre-wrap flex flex-col shadow-inner">
        <div class="text-slate-500 mb-4 block"># Console Output</div>
        <div class="flex-1 overflow-hidden leading-relaxed">{networkLog()}</div>
      </div>
    </div>
  );
}

function SettingsPage() {
  const [hwAccel, setHwAccel] = createSignal(true);
  const [autoUpdate, setAutoUpdate] = createSignal(false);
  return (
    <div class="flex-1 bg-slate-800/40 rounded-3xl p-10 border border-slate-700/50 shadow-xl flex flex-col gap-6">
      <h2 class="text-sm text-slate-400 font-bold tracking-widest uppercase mb-4 flex items-center gap-2">
        <Settings size={18} /> Preferences
      </h2>
      <div
        class="flex items-center justify-between p-6 bg-slate-800/50 rounded-2xl border border-slate-700/50 cursor-pointer hover:bg-slate-700/50 transition-colors"
        onClick={() => setHwAccel(!hwAccel())}
      >
        <div>
          <div class="text-white font-bold text-xl mb-1">
            Hardware Acceleration
          </div>
          <div class="text-slate-400 text-base">
            Use GPU for Vello rendering when available to maximize frame rates
          </div>
        </div>
        <div
          class={`w-16 h-8 rounded-full p-1 transition-colors duration-300 flex items-center ${hwAccel() ? "bg-cyan-500" : "bg-slate-600"}`}
        >
          <div
            class={`w-6 h-6 bg-white rounded-full transition-all duration-300 shadow-md ${hwAccel() ? "ml-8" : "ml-0"}`}
          />
        </div>
      </div>
      <div
        class="flex items-center justify-between p-6 bg-slate-800/50 rounded-2xl border border-slate-700/50 cursor-pointer hover:bg-slate-700/50 transition-colors"
        onClick={() => setAutoUpdate(!autoUpdate())}
      >
        <div>
          <div class="text-white font-bold text-xl mb-1">Automatic Updates</div>
          <div class="text-slate-400 text-base">
            Download and install engine updates silently in the background
          </div>
        </div>
        <div
          class={`w-16 h-8 rounded-full p-1 transition-colors duration-300 flex items-center ${autoUpdate() ? "bg-cyan-500" : "bg-slate-600"}`}
        >
          <div
            class={`w-6 h-6 bg-white rounded-full transition-all duration-300 shadow-md ${autoUpdate() ? "ml-8" : "ml-0"}`}
          />
        </div>
      </div>

      <div class="mt-4 p-6 border border-indigo-500/30 bg-indigo-500/10 rounded-2xl flex-1 flex flex-col justify-center items-center text-center">
        <div class="text-indigo-300 font-bold text-xl mb-3">
          About Blitz Native Environment
        </div>
        <div class="text-slate-400 text-lg leading-relaxed">
          Blitz-DOM v0.3.0-alpha.6
          <br />
          Vello GPU Renderer
          <br />
          SolidJS / rQuickJS Integration
        </div>
      </div>
    </div>
  );
}

function App(): JSX.Element {
  onMount(() => {
    try {
      setSysData(sysInfo());
    } catch (e) {
      setSysData("Rust FFI 'sysInfo' not found.");
    }
  });
  return (
    <div
      class="flex w-full h-full bg-[#0B0F19] text-slate-100 font-sans select-none overflow-hidden"
      style="width: 100%; height: 100vh;"
    >
      <Sidebar />
      <div class="flex-1 flex flex-col relative bg-gradient-to-br from-[#0B0F19] to-[#111827] overflow-hidden">
        <Header />
        <div class="flex-1 p-10 overflow-hidden flex flex-col">
          <NativeRoute path="/" component={Dashboard} />
          <NativeRoute path="/network" component={Network} />
          <NativeRoute path="/settings" component={SettingsPage} />
        </div>
      </div>
    </div>
  );
}

registerRoot(ROOT);
render(
  () =>
    (
      <NativeRouter>
        <App />
      </NativeRouter>
    ) as any,
  ROOT,
);
