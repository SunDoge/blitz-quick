import "@blitz-quick/core";
import "./reset.css";
import "virtual:uno.css";
import { mount } from "@blitz-quick/solid-renderer";
import { MemoryRouter, Route, useLocation } from "@solidjs/router";
import Globe from "lucide-solid/icons/globe";
import Keyboard from "lucide-solid/icons/keyboard";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import ScrollText from "lucide-solid/icons/scroll-text";
import Settings from "lucide-solid/icons/settings";
import { createSignal, For, type JSX, onMount } from "solid-js";
import { Sidebar, type Tab } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { InputDemo } from "./pages/InputDemo";
import { Logs } from "./pages/Logs";
import { Network } from "./pages/Network";
import { Settings as SettingsPage } from "./pages/Settings";

const [sysData, setSysData] = createSignal("Loading OS Data...");

/** Single source of truth for nav + routes. Add a tab here and both the
 * sidebar and the route table pick it up — no other edits needed. */
const TABS: Tab[] = [
  {
    path: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    component: () => <Dashboard sysData={sysData()} />,
  },
  { path: "/input", label: "Inputs", icon: Keyboard, component: InputDemo },
  { path: "/network", label: "Network", icon: Globe, component: Network },
  { path: "/logs", label: "Logs", icon: ScrollText, component: Logs },
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

mount(() => (
  <MemoryRouter root={App}>
    <For each={TABS}>
      {(tab) => <Route path={tab.path} component={tab.component} />}
    </For>
  </MemoryRouter>
));
