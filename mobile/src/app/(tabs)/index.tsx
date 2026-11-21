import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEvents } from "../../data";
import { colors } from "../../theme";
import { EventListItem } from "../../components/EventListItem";
import { OptionSheet } from "../../components/OptionSheet";
import {
  formatMonthFull,
  genreFilterLabel,
  genresByVisualGroup,
  groupByMonth,
  isPastEvent,
  isThisWeekend,
  isTonight,
  matchesGenreSelection,
  type GenreFilterValue,
} from "../../shared";

type Mode = "all" | "tonight" | "weekend";
const MODES: { value: Mode; label: string }[] = [
  { value: "tonight", label: "Tonight" },
  { value: "weekend", label: "This Weekend" },
  { value: "all", label: "Upcoming" },
];

const GENRE_SECTIONS = [
  { data: [{ value: "all", label: "All genres" }] },
  ...genresByVisualGroup().map(({ group, genres }) => ({
    title: group.label,
    data: genres.map((g) => ({ value: g.slug, label: g.label })),
  })),
];

export default function EventsScreen() {
  const insets = useSafeAreaInsets();
  const { events, error, refreshing, refresh } = useEvents();
  const [mode, setMode] = useState<Mode>("all");
  const [genre, setGenre] = useState<GenreFilterValue | "all">("all");
  const [venueId, setVenueId] = useState<string>("all");
  const [sheet, setSheet] = useState<"genre" | "venue" | null>(null);

  // Same rules as the website's EventExplorer: past events drop out as the
  // clock moves, and the venue list only offers venues with upcoming events.
  // A few hundred events at most, so filtering on every render is cheap.
  const now = new Date();
  const upcoming = (events ?? []).filter((e) => !isPastEvent(e, now));
  const venueOptions = [...new Map(upcoming.map((e) => [e.venue.id, e.venue.name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
  const filtered = upcoming.filter((e) => {
    if (mode === "tonight" && !isTonight(e, now)) return false;
    if (mode === "weekend" && !isThisWeekend(e, now)) return false;
    if (genre !== "all" && !matchesGenreSelection(e.subgenres, genre)) return false;
    if (venueId !== "all" && e.venue.id !== venueId) return false;
    return true;
  });
  const sections = groupByMonth(filtered).map((g) => ({
    key: g.monthKey,
    title: `${formatMonthFull(g.month)} ${g.year}`,
    data: g.events,
  }));

  const venueLabel = venueOptions.find((v) => v.value === venueId)?.label ?? "All venues";
  const filtersActive = genre !== "all" || venueId !== "all";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Text style={styles.brand}>Electronic CPH</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {MODES.map((m) => (
          <Pill key={m.value} label={m.label} active={mode === m.value} onPress={() => setMode(m.value)} />
        ))}
        <View style={styles.divider} />
        <Pill label={genre === "all" ? "Genre ▾" : `${genreFilterLabel(genre)} ▾`} active={genre !== "all"} onPress={() => setSheet("genre")} />
        <Pill label={venueId === "all" ? "Venue ▾" : `${venueLabel} ▾`} active={venueId !== "all"} onPress={() => setSheet("venue")} />
        {filtersActive && (
          <Pill
            label="Clear"
            active={false}
            onPress={() => {
              setGenre("all");
              setVenueId("all");
            }}
          />
        )}
      </ScrollView>

      {events === null && !error ? (
        <ActivityIndicator style={styles.loading} color={colors.accent} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <EventListItem event={item} />}
          renderSectionHeader={({ section }) => <Text style={styles.month}>{section.title}</Text>}
          stickySectionHeadersEnabled
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {error ??
                  (mode === "tonight" ? "Nothing listed for tonight." : mode === "weekend" ? "Nothing listed for this weekend." : "No events match these filters.")}
              </Text>
              {error && (
                <Pressable onPress={refresh}>
                  <Text style={styles.retry}>Try again</Text>
                </Pressable>
              )}
            </View>
          }
          contentInsetAdjustmentBehavior="automatic"
        />
      )}

      <OptionSheet
        visible={sheet === "genre"}
        title="Genre"
        sections={GENRE_SECTIONS}
        selected={genre}
        onSelect={(v) => setGenre(v as GenreFilterValue | "all")}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === "venue"}
        title="Venue"
        sections={[{ data: [{ value: "all", label: "All venues" }, ...venueOptions] }]}
        selected={venueId}
        onSelect={setVenueId}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]} accessibilityState={{ selected: active }}>
      <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  brand: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: -0.5,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pills: { gap: 8, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center" },
  divider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: colors.borderStrong, marginHorizontal: 2 },
  pill: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, maxWidth: 200 },
  pillActive: { borderColor: colors.accent, backgroundColor: "rgba(171, 155, 224, 0.15)" },
  pillText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  pillTextActive: { color: colors.accentStrong },
  loading: { marginTop: 48 },
  month: {
    color: colors.textTertiary,
    backgroundColor: colors.bg,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  empty: { padding: 32, alignItems: "center", gap: 12 },
  emptyText: { color: colors.textSecondary, fontSize: 15, textAlign: "center" },
  retry: { color: colors.accent, fontSize: 15, fontWeight: "600" },
});
