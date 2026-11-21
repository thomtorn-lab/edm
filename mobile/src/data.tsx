import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AppEvent, AppEventsResponse } from "./shared";

/**
 * Events come only from the website's public GET /api/v1/events; nothing is
 * cached on the phone except saved events. The app holds no secrets: every
 * EXPO_PUBLIC_* value ends up readable in the app bundle.
 *
 * Unpublished or edited events: the CDN reuses a response for at most 60 s
 * (the route's Cache-Control), and the app re-fetches whenever its copy is
 * older than 60 s — every minute while open, on returning to the app, and
 * before showing an event's details — plus on pull-to-refresh. An event
 * unpublished on the website therefore disappears within about 2 minutes,
 * and its ticket links are hidden as soon as it is gone from the list.
 */
const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://www.electroniccph.com").replace(/\/$/, "");
const MAX_AGE_MS = 60_000;
const FAVORITES_KEY = "favorites:v1";

interface EventsState {
  events: AppEvent[] | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Re-fetches only when the current list is older than MAX_AGE_MS. */
  refreshIfStale: () => void;
  /** Saved events by id, with the snapshot taken when they were saved. */
  favorites: Record<string, AppEvent>;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (event: AppEvent) => void;
}

const EventsContext = createContext<EventsState | null>(null);

export function EventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<AppEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, AppEvent>>({});
  const lastFetch = useRef(0);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`${API_URL}/api/v1/events`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as AppEventsResponse;
      setEvents(body.events);
      setError(null);
      lastFetch.current = Date.now();
    } catch {
      setError("Couldn't load events. Check your connection and try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const refreshIfStale = useCallback(() => {
    if (Date.now() - lastFetch.current >= MAX_AGE_MS) refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    // iOS pauses timers in the background, so this only runs while the app is open.
    const timer = setInterval(refreshIfStale, MAX_AGE_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshIfStale();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh, refreshIfStale]);

  useEffect(() => {
    AsyncStorage.getItem(FAVORITES_KEY)
      .then((raw) => raw && setFavorites(JSON.parse(raw)))
      .catch(() => {});
  }, []);

  const toggleFavorite = useCallback((event: AppEvent) => {
    setFavorites((current) => {
      const next = { ...current };
      if (next[event.id]) delete next[event.id];
      else next[event.id] = event;
      AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<EventsState>(
    () => ({ events, error, refreshing, refresh, refreshIfStale, favorites, isFavorite: (id) => id in favorites, toggleFavorite }),
    [events, error, refreshing, refresh, refreshIfStale, favorites, toggleFavorite],
  );
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEvents(): EventsState {
  const value = useContext(EventsContext);
  if (!value) throw new Error("useEvents must be used inside EventsProvider");
  return value;
}
