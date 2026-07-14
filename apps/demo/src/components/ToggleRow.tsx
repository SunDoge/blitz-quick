import { Switch } from "./Switch";

export function ToggleRow(props: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      class="w-full text-left flex items-center justify-between gap-4 p-6 bg-slate-800/50 rounded-2xl border border-slate-700/50 cursor-pointer hover:bg-slate-700/50 transition-colors"
      onClick={() => props.onChange(!props.checked)}
    >
      <div class="flex-1 min-w-0">
        <div class="text-white font-bold text-xl mb-1">{props.title}</div>
        <div class="text-slate-400 text-base">{props.description}</div>
      </div>
      <Switch checked={props.checked} />
    </button>
  );
}
