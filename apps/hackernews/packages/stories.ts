import { createSignal } from "solid-js";

declare global {
  function fetchTopStories(): Promise<string>;
}

export interface Story {
  id: number;
  title: string;
  url: string;
  by: string;
  score: number;
  descendants: number;
  time?: number;
}

const storiesSignal = createSignal<Story[]>([]);
const loadingSignal = createSignal(true);
const loadErrorSignal = createSignal<string | null>(null);
const querySignal = createSignal("");

export const stories = storiesSignal[0];
export const setStories = storiesSignal[1];
export const loading = loadingSignal[0];
export const setLoading = loadingSignal[1];
export const loadError = loadErrorSignal[0];
export const setLoadError = loadErrorSignal[1];
export const query = querySignal[0];
export const setQuery = querySignal[1];

export async function loadStories(): Promise<void> {
  setLoading(true);
  setLoadError(null);
  try {
    const result = JSON.parse(await fetchTopStories()) as Story[];
    setStories(result.filter((story) => story?.id && story?.title));
  } catch (cause) {
    setLoadError(cause instanceof Error ? cause.message : String(cause));
  } finally {
    setLoading(false);
  }
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
