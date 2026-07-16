// Minimal `document` and `window` stubs. Many libraries probe these globals
// for feature detection rather than real use; the stubs keep that detection
// happy without implying a full DOM.

export function installDomGlobals(): void {
  (globalThis as any).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    baseURI: "http://localhost",
  };

  (globalThis as any).window = {
    history: {
      state: {},
      replaceState: function (s: any) {
        this.state = s;
      },
      go: function () {},
      length: 1,
    },
    location: {
      origin: "http://localhost",
      pathname: "/",
      search: "",
      hash: "",
    },
    scrollTo: function () {},
  };
}
