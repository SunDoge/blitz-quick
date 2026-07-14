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
