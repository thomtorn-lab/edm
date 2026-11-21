import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEvents } from "../../data";
import { colors } from "../../theme";
import { FavoriteButton } from "../../components/FavoriteButton";
import { displayGenres, formatFullDateRangeLabel, formatTimeRangeLabel } from "../../shared";

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { events, favorites } = useEvents();
  const listed = events?.find((e) => e.id === id);
  const event = listed ?? favorites[id];

  if (!event) {
    return (
      <View style={styles.missing}>
        <Text style={styles.muted}>This event is no longer listed.</Text>
      </View>
    );
  }

  // Same primary action as the website's event page: Tickets first, else Official event.
  const primary = event.links.find((l) => l.label === "Tickets") ?? event.links.find((l) => l.label === "Official event") ?? null;
  const secondary = event.links.filter((l) => l !== primary);
  const genres = displayGenres(event.subgenres);
  const unlisted = events !== null && !listed;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable onPress={() => Share.share({ message: `${event.title} – ${event.url}`, url: event.url })} hitSlop={12}>
                <Text style={styles.headerAction}>Share</Text>
              </Pressable>
              <FavoriteButton event={event} size={24} />
            </View>
          ),
        }}
      />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {(unlisted || event.statuses.length > 0) && (
          <View style={styles.badges}>
            {unlisted && <Text style={[styles.badge, styles.badgeBad]}>No longer listed</Text>}
            {event.statuses.map((s) => (
              <Text key={s} style={[styles.badge, s === "Postponed" && styles.badgeBad]}>
                {s}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.title}>{event.title}</Text>

        <View style={styles.block}>
          <Text style={styles.date}>{formatFullDateRangeLabel(event)}</Text>
          <Text style={styles.time}>{formatTimeRangeLabel(event)}</Text>
        </View>

        <Pressable
          style={styles.block}
          onPress={() => Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(`${event.venue.name}, ${event.venue.address}`)}`)}
        >
          <Text style={styles.venue}>
            {event.venue.name}
            {event.subVenue ? ` · ${event.subVenue}` : ""}
          </Text>
          {event.venue.address ? <Text style={styles.address}>{event.venue.address} ↗</Text> : null}
        </Pressable>

        {genres.length > 0 && (
          <View style={styles.chips}>
            {genres.map((g) => (
              <Text key={g.slug} style={styles.chip}>
                {g.label}
              </Text>
            ))}
          </View>
        )}

        {!unlisted && (primary || event.free) && (
          <View style={styles.actions}>
            {primary && (
              <Pressable style={styles.primaryButton} onPress={() => WebBrowser.openBrowserAsync(primary.href)}>
                <Text style={styles.primaryText}>{primary.label}</Text>
              </Pressable>
            )}
            {!primary && event.free && <Text style={styles.free}>Free entry</Text>}
          </View>
        )}
        {!unlisted &&
          secondary.map((link) => (
            <Pressable key={link.href} style={styles.secondaryButton} onPress={() => WebBrowser.openBrowserAsync(link.href)}>
              <Text style={styles.secondaryText}>{link.label} ↗</Text>
            </Pressable>
          ))}

        {event.lineup.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lineup</Text>
            {event.lineup.map((artist) => (
              <Text key={artist} style={styles.artist}>
                {artist}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48, gap: 16 },
  missing: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textSecondary, fontSize: 15 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 18 },
  headerAction: { color: colors.accent, fontSize: 17 },
  badges: { flexDirection: "row", gap: 6 },
  badge: {
    color: colors.textSecondaryStrong,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    overflow: "hidden",
  },
  badgeBad: { color: colors.statusBad, borderColor: "rgba(201, 114, 114, 0.4)" },
  title: { color: colors.textPrimary, fontSize: 30, fontWeight: "900", textTransform: "uppercase", letterSpacing: -0.5 },
  block: { gap: 2 },
  date: { color: colors.accent, fontSize: 16, fontWeight: "700" },
  time: { color: colors.textSecondary, fontSize: 15, fontVariant: ["tabular-nums"] },
  venue: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
  address: { color: colors.textSecondary, fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    color: colors.textSecondaryStrong,
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    fontSize: 13,
    overflow: "hidden",
  },
  actions: { marginTop: 4 },
  primaryButton: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 15, alignItems: "center" },
  primaryText: { color: colors.accentOn, fontSize: 16, fontWeight: "700" },
  free: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  secondaryButton: { borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  secondaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  section: { gap: 6, marginTop: 8 },
  sectionTitle: { color: colors.textTertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  artist: { color: colors.textPrimary, fontSize: 17 },
});
