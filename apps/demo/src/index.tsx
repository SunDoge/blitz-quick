import "@blitz-quick/core";
import { type Handle, registerRoot, render } from "@blitz-quick/solid-renderer";
import { MemoryRouter, Route, useLocation } from "@solidjs/router";
import {
  Activity,
  Globe,
  Keyboard,
  LayoutDashboard,
  ScrollText,
  Server,
  Settings,
  Zap,
} from "lucide-solid";
import { createSignal, For, type JSX, onMount } from "solid-js";
import { Sidebar, type Tab } from "./components/Sidebar";
import { ToggleRow } from "./components/Switch";

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

const [sysData, setSysData] = createSignal("Loading OS Data...");

/** Single source of truth for nav + routes. Add a tab here and both the
 * sidebar and the route table pick it up — no other edits needed. */
const TABS: Tab[] = [
  {
    path: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    component: Dashboard,
  },
  { path: "/input", label: "Inputs", icon: Keyboard, component: InputDemoTab },
  { path: "/network", label: "Network", icon: Globe, component: Network },
  { path: "/logs", label: "Logs", icon: ScrollText, component: LogsPage },
  {
    path: "/settings",
    label: "Settings",
    icon: Settings,
    component: SettingsPage,
  },
];

function Header() {
  const location = useLocation();
  const title = () => {
    const p = location.pathname;
    if (p === "/") return "Dashboard";
    return p.slice(1).charAt(0).toUpperCase() + p.slice(2);
  };
  return (
    <div class="h-20 flex items-center justify-between px-10 border-b border-slate-800/50 z-10 bg-[#0B0F19]/50 backdrop-blur-md">
      <h1 class="text-2xl font-semibold text-white tracking-tight">
        {title()}
      </h1>
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
              type="button"
              class="px-8 py-3 bg-indigo-500 text-white rounded-xl font-bold hover:bg-indigo-400 transition-colors shadow-lg active:scale-95"
              onClick={() => setCount((c) => c - 1)}
            >
              DECREASE
            </button>
            <button
              type="button"
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

function InputDemoTab() {
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
            onInput={(e) => setText(e.currentTarget.value)}
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
          type="button"
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

function LogsPage() {
  // 60 fake log lines so the container overflows and a scrollbar thumb appears.
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
  const lines = Array.from({ length: 60 }, (_, i) => {
    const lvl = levels[i % levels.length];
    const msg = messages[i % messages.length];
    const ts = `0${Math.floor(i / 60)}:${String(i % 60).padStart(2, "0")}:${String(
      (i * 137) % 1000,
    ).padStart(3, "0")}`;
    return { i, ts, lvl, msg };
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
              <span class="text-slate-600 shrink-0">{line.ts}</span>
              <span class={`shrink-0 w-12 font-bold ${line.lvl[1]}`}>
                {line.lvl[0]}
              </span>
              <span class="text-slate-300">
                [node#{line.i}] {line.msg}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function SettingsPage() {
  const [hwAccel, setHwAccel] = createSignal(true);
  const [autoUpdate, setAutoUpdate] = createSignal(false);
  return (
    <div class="flex-1 min-h-0 overflow-y-auto bg-slate-800/40 rounded-3xl p-10 border border-slate-700/50 shadow-xl flex flex-col gap-6">
      <h2 class="text-sm text-slate-400 font-bold tracking-widest uppercase mb-4 flex items-center gap-2">
        <Settings size={18} /> Preferences
      </h2>
      <ToggleRow
        title="Hardware Acceleration"
        description="Use GPU for Vello rendering when available to maximize frame rates"
        checked={hwAccel()}
        onChange={setHwAccel}
      />
      <ToggleRow
        title="Automatic Updates"
        description="Download and install engine updates silently in the background"
        checked={autoUpdate()}
        onChange={setAutoUpdate}
      />

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

function App(props: { children?: JSX.Element }): JSX.Element {
  onMount(() => {
    try {
      setSysData(sysInfo());
    } catch {
      setSysData("Rust FFI 'sysInfo' not found.");
    }
  });
  return (
    <div
      class="flex w-full h-full bg-[#0B0F19] text-slate-100 font-sans select-none overflow-hidden"
      style="width: 100%; height: 100vh;"
    >
      <Sidebar tabs={TABS} />
      <div class="flex-1 flex flex-col relative bg-gradient-to-br from-[#0B0F19] to-[#111827] overflow-hidden">
        <Header />
        <div class="flex-1 min-h-0 p-10 overflow-hidden flex flex-col">
          {props.children}
        </div>
      </div>
    </div>
  );
}

registerRoot(ROOT);
render(
  () => (
    <MemoryRouter root={App}>
      <For each={TABS}>
        {(tab) => <Route path={tab.path} component={tab.component} />}
      </For>
    </MemoryRouter>
  ),
  ROOT,
);
