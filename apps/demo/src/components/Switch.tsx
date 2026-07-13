/** A toggle switch thumb. `shrink-0` keeps it from being squeezed by long
 * sibling text in a flex row; the track is a fixed `w-16 h-8` box and the
 * thumb slides between the two ends via margin. */
export function Switch(props: { checked: boolean }) {
  return (
    <div
      class={`shrink-0 w-16 h-8 rounded-full p-1 transition-colors duration-300 flex items-center ${props.checked ? "bg-cyan-500" : "bg-slate-600"}`}
    >
      <div
        class={`w-6 h-6 bg-white rounded-full transition-all duration-300 shadow-md ${props.checked ? "ml-8" : "ml-0"}`}
      />
    </div>
  );
}

/** A settings row: title + description on the left, switch on the right.
 * The text column is `flex-1 min-w-0` so it wraps/shrinks instead of pushing
 * the switch off the edge. */
export function ToggleRow(props: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      class="flex items-center justify-between gap-4 p-6 bg-slate-800/50 rounded-2xl border border-slate-700/50 cursor-pointer hover:bg-slate-700/50 transition-colors"
      onClick={() => props.onChange(!props.checked)}
    >
      <div class="flex-1 min-w-0">
        <div class="text-white font-bold text-xl mb-1">{props.title}</div>
        <div class="text-slate-400 text-base">{props.description}</div>
      </div>
      <Switch checked={props.checked} />
    </div>
  );
}
