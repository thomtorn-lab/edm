import { Pressable, StyleSheet, Text } from "react-native";
import { useEvents } from "../data";
import { colors } from "../theme";
import type { AppEvent } from "../shared";

export function FavoriteButton({ event, size = 22 }: { event: AppEvent; size?: number }) {
  const { isFavorite, toggleFavorite } = useEvents();
  const saved = isFavorite(event.id);
  return (
    <Pressable
      onPress={() => toggleFavorite(event)}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={saved ? "Remove from saved" : "Save event"}
      style={styles.button}
    >
      <Text style={{ fontSize: size, color: saved ? colors.accent : colors.textTertiary }}>{saved ? "★" : "☆"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({ button: { paddingLeft: 4 } });
