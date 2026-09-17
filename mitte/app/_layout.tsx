import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { loadSettings } from '../src/settings';
import { useTheme } from '../src/theme';

export default function RootLayout() {
  const t = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setReady(true);
      if (!s.onboarded) router.replace('/onboarding');
    });
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: t.bg },
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen
          name="eintrag"
          options={{ presentation: 'modal', title: 'Wie geht es deinem Bauch?' }}
        />
        <Stack.Screen name="essen" options={{ presentation: 'modal', title: 'Essen & Trinken' }} />
        <Stack.Screen name="eintrag/[id]" options={{ title: 'Eintrag' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
