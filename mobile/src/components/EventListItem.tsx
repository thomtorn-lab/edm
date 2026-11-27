import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { colors } from "../theme";
import { displayGenres, formatRowDateRangeLabel, formatTimeRangeLabel, type AppEvent } from "../shared";
import { FavoriteButton } from "./FavoriteButton";

/** One event in a list — the same fields as the website's EventRow. */
export function EventListItem({ event, unavailable = false }: { event: AppEvent; unavailable?: boolean }) {
  const genres = displayGenres(event.subgenres);
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/event/[id]", params: { id: event.id } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, unavailable && styles.unavailable]}
    >
      <View style={styles.when}>
        <Text style={styles.date}>{formatRowDateRangeLabel(event)}</Text>
        <Text style={styles.time}>{formatTimeRangeLabel(event)}</Text>
      </View>
      <View style={styles.body}>
        {(event.statuses.length > 0 || unavailable) && (
          <View style={styles.badges}>
            {unavailable && <Text style={[styles.badge, styles.badgeBad]}>No longer listed</Text>}
            {event.statuses.map((s) => (
              <Text key={s} style={[styles.badge, s === "Postponed" && styles.badgeBad]}>
                {s}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
        </Text>
        {event.lineup.length > 0 && (
          <Text style={styles.lineup} numberOfLines={2}>
            {event.lineup.join(" / ")}
          </Text>
        )}
        <Text style={styles.venue} numberOfLines={1}>
          {event.venue.name}
          {event.subVenue ? ` · ${event.subVenue}` : ""}
        </Text>
        {genres.length > 0 && <Text style={styles.genres}>{genres.map((g) => g.label).join(" · ")}</Text>}
      </View>
      <FavoriteButton event={event} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.bg,
  },
  pressed: { backgroundColor: colors.surface2 },
  unavailable: { opacity: 0.55 },
  when: { width: 88 },
  date: { color: colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  time: { color: colors.textTertiary, fontSize: 12, marginTop: 2, fontVariant: ["tabular-nums"] },
  body: { flex: 1, gap: 3 },
  badges: { flexDirection: "row", gap: 6, marginBottom: 2 },
  badge: {
    color: colors.textSecondaryStrong,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    overflow: "hidden",
  },
  badgeBad: { color: colors.statusBad, borderColor: "rgba(201, 114, 114, 0.4)" },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  lineup: { color: colors.textSecondaryStrong, fontSize: 14 },
  venue: { color: colors.textSecondary, fontSize: 13 },
  genres: { color: colors.textTertiary, fontSize: 12 },
});
