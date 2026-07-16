// console polyfill. Routes log/info/warn/error/debug to the host logger.

function emitConsole(tag: string, args: IArguments) {
  const parts = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    parts.push(typeof a === "string" ? a : String(a));
  }
  __host_log_level(tag, parts.join(" "));
}

export function installConsole(): void {
  (globalThis as any).console = {
    log: function () {
      emitConsole("log", arguments);
    },
    info: function () {
      emitConsole("info", arguments);
    },
    warn: function () {
      emitConsole("warn", arguments);
    },
    error: function () {
      emitConsole("error", arguments);
    },
    debug: function () {
      emitConsole("debug", arguments);
    },
  };
}
