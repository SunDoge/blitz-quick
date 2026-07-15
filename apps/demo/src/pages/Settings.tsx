import SettingsIcon from "lucide-solid/icons/settings";
import { createSignal } from "solid-js";
import { ToggleRow } from "../components/ToggleRow";

export function Settings() {
  const [hwAccel, setHwAccel] = createSignal(true);
  const [autoUpdate, setAutoUpdate] = createSignal(false);
  return (
    <div class="flex-1 min-h-0 overflow-y-auto bg-slate-800/40 rounded-3xl p-10 border border-slate-700/50 shadow-xl flex flex-col gap-6">
      <h2 class="text-sm text-slate-400 font-bold tracking-widest uppercase mb-4 flex items-center gap-2">
        <SettingsIcon size={18} /> Preferences
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
