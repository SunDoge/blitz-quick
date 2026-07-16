import { createSignal } from "solid-js";

declare global {
  function fetchStories(feed: Feed): Promise<string>;
}

export type Feed = "top" | "new" | "best";
export type View = Feed | "saved";

export interface Story {
  id: number;
  title: string;
  url: string;
  by: string;
  score: number;
  descendants: number;
  time?: number;
}

const [stories, setStories] = createSignal<Story[]>([]);
const [savedStories, setSavedStories] = createSignal<Story[]>([]);
const [visitedIds, setVisitedIds] = createSignal<number[]>([]);
const [activeView, setActiveView] = createSignal<View>("top");
const [loading, setLoading] = createSignal(true);
const [loadError, setLoadError] = createSignal<string | null>(null);
const [query, setQuery] = createSignal("");

export {
  activeView,
  loadError,
  loading,
  query,
  savedStories,
  setQuery,
  stories,
};

export const viewLabels: Record<View, string> = {
  top: "Top stories",
  new: "New stories",
  best: "Best stories",
  saved: "Saved stories",
};

export function visibleSource(): Story[] {
  return activeView() === "saved" ? savedStories() : stories();
}

export async function selectView(view: View): Promise<void> {
  if (activeView() === view) return;
  setActiveView(view);
  setQuery("");
  if (view !== "saved") await loadStories(view);
}

export async function loadStories(feed?: Feed): Promise<void> {
  const selected = feed ?? activeView();
  if (selected === "saved") return;
  setLoading(true);
  setLoadError(null);
  try {
    const result = JSON.parse(await fetchStories(selected)) as Story[];
    setStories(result.filter((story) => story?.id && story?.title));
  } catch (cause) {
    setLoadError(cause instanceof Error ? cause.message : String(cause));
  } finally {
    setLoading(false);
  }
}

export function toggleSaved(story: Story): void {
  setSavedStories((current) =>
    current.some((item) => item.id === story.id)
      ? current.filter((item) => item.id !== story.id)
      : [...current, story],
  );
}

export function isSaved(id: number): boolean {
  return savedStories().some((story) => story.id === id);
}

export function markVisited(id: number): void {
  setVisitedIds((current) =>
    current.includes(id) ? current : [...current, id],
  );
}

export function isVisited(id: number): boolean {
  return visitedIds().includes(id);
}

export function storyHost(url: string): string {
  if (!url) return "news.ycombinator.com";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "external link";
  }
}

export function relativeTime(timestamp?: number): string {
  if (!timestamp) return "recently";
  const minutes = Math.max(1, Math.floor((Date.now() / 1000 - timestamp) / 60));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
