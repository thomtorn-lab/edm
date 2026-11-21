import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AppEvent, AppEventsResponse } from "./shared";

/**
 * Events come only from the website's GET /api/v1/events, so an event that is
 * unpublished or edited there changes here on the next refresh: on launch, on
 * pull-to-refresh, and when the app returns to the foreground after a minute.
 * Nothing is cached on the phone except saved events.
 */
const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://www.electroniccph.com").replace(/\/$/, "");
// Only for testing against a protected Vercel Preview deployment.
const PREVIEW_BYPASS = process.env.EXPO_PUBLIC_VERCEL_BYPASS;
const REFRESH_AFTER_MS = 60_000;
const FAVORITES_KEY = "favorites:v1";

interface EventsState {
  events: AppEvent[] | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
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
      const response = await fetch(`${API_URL}/api/v1/events`, {
        headers: PREVIEW_BYPASS ? { "x-vercel-protection-bypass": PREVIEW_BYPASS } : undefined,
      });
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

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && Date.now() - lastFetch.current > REFRESH_AFTER_MS) refresh();
    });
    return () => sub.remove();
  }, [refresh]);

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
    () => ({ events, error, refreshing, refresh, favorites, isFavorite: (id) => id in favorites, toggleFavorite }),
    [events, error, refreshing, refresh, favorites, toggleFavorite],
  );
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEvents(): EventsState {
  const value = useContext(EventsContext);
  if (!value) throw new Error("useEvents must be used inside EventsProvider");
  return value;
}
