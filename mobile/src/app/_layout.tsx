import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { EventsProvider } from "../data";
import { colors } from "../theme";

export default function RootLayout() {
  return (
    <EventsProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.textPrimary },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Events" }} />
        <Stack.Screen name="event/[id]" options={{ title: "" }} />
      </Stack>
    </EventsProvider>
  );
}
