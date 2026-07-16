import { useNavigate } from "@solidjs/router";
import Award from "lucide-solid/icons/award";
import Bookmark from "lucide-solid/icons/bookmark";
import Clock from "lucide-solid/icons/clock";
import Moon from "lucide-solid/icons/moon";
import Newspaper from "lucide-solid/icons/newspaper";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Sun from "lucide-solid/icons/sun";
import { type JSX, onMount } from "solid-js";
import { useTheme } from "../contexts/ThemeContext";
import {
  activeView,
  loading,
  loadStories,
  savedStories,
  selectView,
  stories,
  type View,
} from "../stories";

export function Sidebar(): JSX.Element {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  onMount(() => {
    if (stories().length === 0) void loadStories("top");
  });

  const openView = (view: View) => {
    navigate("/");
    void selectView(view);
  };

  return (
    <aside class="w-60 flex-none flex flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)]">
      <div class="h-18 px-5 flex items-center gap-3">
        <div class="w-8 h-8 rounded-md flex items-center justify-center bg-[var(--color-accent)] text-white font-bold">
          Y
        </div>
        <strong class="text-[var(--color-text)] text-sm">Hacker News</strong>
      </div>

      <nav class="flex-1 px-3 py-3" aria-label="Story feeds">
        <p class="m-0 px-3 pb-2 text-[var(--color-text-muted)] text-xs font-semibold">
          Feeds
        </p>
        <SidebarItem
          active={activeView() === "top"}
          count={activeView() === "top" ? stories().length : undefined}
          icon={<Newspaper size={17} />}
          label="Top"
          onActivate={() => openView("top")}
        />
        <SidebarItem
          active={activeView() === "new"}
          icon={<Clock size={17} />}
          label="New"
          onActivate={() => openView("new")}
        />
        <SidebarItem
          active={activeView() === "best"}
          icon={<Award size={17} />}
          label="Best"
          onActivate={() => openView("best")}
        />

        <p class="m-0 mt-6 px-3 pb-2 text-[var(--color-text-muted)] text-xs font-semibold">
          Library
        </p>
        <SidebarItem
          active={activeView() === "saved"}
          count={savedStories().length || undefined}
          icon={<Bookmark size={17} />}
          label="Saved"
          onActivate={() => openView("saved")}
        />
      </nav>

      <div class="p-4 border-t border-[var(--color-border)]">
        <SidebarItem
          icon={theme() === "light" ? <Moon size={16} /> : <Sun size={16} />}
          label={theme() === "light" ? "Dark theme" : "Light theme"}
          onActivate={toggleTheme}
        />
        <SidebarItem
          disabled={loading()}
          icon={<RefreshCw size={16} class={loading() ? "animate-spin" : ""} />}
          label={loading() ? "Refreshing..." : "Refresh"}
          onActivate={() => void loadStories(undefined, true)}
        />
      </div>
    </aside>
  );
}

interface SidebarItemProps {
  active?: boolean;
  count?: number;
  disabled?: boolean;
  icon: JSX.Element;
  label: string;
  onActivate: () => void;
}

function SidebarItem(props: SidebarItemProps): JSX.Element {
  const activate = () => {
    if (!props.disabled) props.onActivate();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: Blitz currently mislays out flex button elements.
    <div
      class={`w-full h-10 px-3 flex items-center gap-3 rounded-md text-sm cursor-pointer ${
        props.active
          ? "bg-[var(--color-raised)] text-[var(--color-text)] font-semibold"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]"
      } ${props.disabled ? "opacity-50" : ""}`}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") activate();
      }}
      role="button"
      tabIndex={0}
    >
      <span
        class={`pointer-events-none ${
          props.active
            ? "text-[var(--color-accent)]"
            : "text-[var(--color-text-muted)]"
        }`}
      >
        {props.icon}
      </span>
      <span class="pointer-events-none">{props.label}</span>
      {props.count ? (
        <span class="pointer-events-none ml-auto text-[var(--color-text-muted)] text-xs">
          {props.count}
        </span>
      ) : null}
    </div>
  );
}
