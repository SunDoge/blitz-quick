import {
  createContext,
  createSignal,
  type JSX,
  type Setter,
  useContext,
} from "solid-js";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: () => Theme;
  setTheme: Setter<Theme>;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>();

export function ThemeProvider(props: { children: JSX.Element }): JSX.Element {
  const [theme, setTheme] = createSignal<Theme>("light");
  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme: () =>
      setTheme((current) => (current === "light" ? "dark" : "light")),
  };

  return (
    <ThemeContext.Provider value={value}>
      <div
        data-theme={theme()}
        class="w-full h-full bg-[var(--color-bg)] text-[var(--color-text)]"
      >
        {props.children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
