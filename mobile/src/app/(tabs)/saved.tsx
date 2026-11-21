import { FlatList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEvents } from "../../data";
import { colors } from "../../theme";
import { EventListItem } from "../../components/EventListItem";
import { isPastEvent } from "../../shared";

/**
 * Saved events, stored only on this phone. The current version from the
 * website is shown whenever the event is still listed; an event that has
 * been unpublished (or moved out of the listing) stays visible, dimmed, as
 * "No longer listed" until the user removes it. Past events drop off.
 */
export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const { events, favorites } = useEvents();
  const now = new Date();
  const current = new Map((events ?? []).map((e) => [e.id, e]));
  const saved = Object.values(favorites)
    .map((snapshot) => ({ event: current.get(snapshot.id) ?? snapshot, listed: events === null || current.has(snapshot.id) }))
    .filter(({ event }) => !isPastEvent(event, now))
    .sort((a, b) => a.event.startDatetime.localeCompare(b.event.startDatetime));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Text style={styles.heading}>Saved</Text>
      <FlatList
        data={saved}
        keyExtractor={({ event }) => event.id}
        renderItem={({ item }) => <EventListItem event={item.event} unavailable={!item.listed} />}
        ListEmptyComponent={<Text style={styles.empty}>Tap ☆ on an event to save it here.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: -0.5,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  empty: { color: colors.textSecondary, fontSize: 15, textAlign: "center", padding: 32 },
});
