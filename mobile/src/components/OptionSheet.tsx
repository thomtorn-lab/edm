import { Modal, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export interface Option {
  value: string;
  label: string;
}

/** A native page sheet listing filter options, grouped into sections. */
export function OptionSheet({
  visible,
  title,
  sections,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  sections: { title?: string; data: Option[] }[];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.value}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) =>
            section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null
          }
          renderItem={({ item }) => {
            const active = item.value === selected;
            return (
              <Pressable
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                onPress={() => {
                  onSelect(item.value);
                  onClose();
                }}
              >
                <Text style={[styles.optionLabel, active && styles.active]}>{item.label}</Text>
                {active && <Text style={styles.active}>✓</Text>}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.surface1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: "700" },
  done: { color: colors.accent, fontSize: 17, fontWeight: "600" },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  option: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { backgroundColor: colors.surface2 },
  optionLabel: { color: colors.textPrimary, fontSize: 16 },
  active: { color: colors.accent, fontSize: 16, fontWeight: "600" },
});
