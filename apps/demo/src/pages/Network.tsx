import { Globe } from "lucide-solid";
import { createSignal } from "solid-js";

export function Network() {
  const [networkLog, setNetworkLog] = createSignal("Idle.");
  const [isFetching, setIsFetching] = createSignal(false);
  const runNetworkTest = async () => {
    setIsFetching(true);
    setNetworkLog("Fetching data from dummyjson.com...");
    try {
      const response = await fetch("https://dummyjson.com/products/1");
      const data = await response.json();
      setNetworkLog(
        `Success! \n\nProduct: ${data.title}\nPrice: $${data.price}\nCategory: ${data.category}\n\nDescription: ${data.description}`,
      );
    } catch (error) {
      setNetworkLog(`Error: ${String(error)}`);
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
