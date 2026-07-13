import { createSignal } from "solid-js";

export let activeInputSetter: ((f: boolean) => void) | null = null;

export function clearActiveInput() {
  if (activeInputSetter) {
    activeInputSetter(false);
    activeInputSetter = null;
  }
}

export function CustomTextInput(props: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = createSignal(false);

  const handlePointerDown = (e: any) => {
    e.stopPropagation?.();
    if (activeInputSetter && activeInputSetter !== setFocused) {
      activeInputSetter(false);
    }
    activeInputSetter = setFocused;
    setFocused(true);
  };

  const handleKeyDown = (e: any) => {
    // Stop propagation so it doesn't trigger global shortcuts if we add any
    e.stopPropagation?.();

    if (e.code === "Backspace") {
      props.onInput(props.value.slice(0, -1));
    } else if (e.code === "Space") {
      props.onInput(`${props.value} `);
    } else if (e.key && e.key.length === 1) {
      props.onInput(props.value + e.key);
    }
  };

  return (
    <div
      onClick={handlePointerDown}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      class={`w-full max-w-sm px-4 py-3 bg-slate-900 border rounded-xl text-white transition-all mb-4 cursor-text ${
        focused()
          ? "border-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.5)]"
          : "border-slate-700"
      }`}
    >
      {props.value || <span class="text-slate-500">{props.placeholder}</span>}
      {focused() ? (
        <span class="animate-pulse text-pink-500 font-bold ml-1">|</span>
      ) : (
        ""
      )}
    </div>
  );
}
