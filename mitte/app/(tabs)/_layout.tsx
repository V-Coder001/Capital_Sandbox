import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useTheme } from '../../src/theme';

function icon(symbol: string) {
  return ({ color }: { color: string }) => <Text style={{ fontSize: 20, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerShadowVisible: false,
        headerTintColor: t.text,
        sceneStyle: { backgroundColor: t.bg },
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Heute', tabBarIcon: icon('◎') }} />
      <Tabs.Screen name="verlauf" options={{ title: 'Verlauf', tabBarIcon: icon('≡') }} />
      <Tabs.Screen name="woche" options={{ title: 'Woche', tabBarIcon: icon('◍') }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil', tabBarIcon: icon('☺') }} />
    </Tabs>
  );
}
