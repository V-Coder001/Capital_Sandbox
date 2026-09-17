import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Card, Chip, Muted, PrimaryButton, Row, SectionTitle } from '../components/ui';
import { addCustomTile, addIntake, customTiles } from '../src/db';
import { suggestMeal } from '../src/dates';
import { spacing, useTheme } from '../src/theme';
import { DRINK_CATEGORIES, FOOD_CATEGORIES, MEAL_LABELS } from '../src/types';
import type { Meal } from '../src/types';

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export default function IntakeSheet() {
  const t = useTheme();
  const [meal, setMeal] = useState<Meal>(suggestMeal());
  const [foods, setFoods] = useState<string[]>([]);
  const [drinks, setDrinks] = useState<string[]>([]);
  const [waterGlasses, setWaterGlasses] = useState(0);
  const [ownFood, setOwnFood] = useState<{ id: number; label: string }[]>([]);
  const [ownDrink, setOwnDrink] = useState<{ id: number; label: string }[]>([]);
  const [newFood, setNewFood] = useState('');
  const [newDrink, setNewDrink] = useState('');

  useEffect(() => {
    customTiles('food').then(setOwnFood);
    customTiles('drink').then(setOwnDrink);
  }, []);

  const toggle = (list: string[], set: (v: string[]) => void, key: string) => {
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  };

  const addOwn = async (kind: 'food' | 'drink', label: string) => {
    const name = label.trim();
    if (!name) return;
    await addCustomTile(kind, name);
    if (kind === 'food') {
      setOwnFood(await customTiles('food'));
      setNewFood('');
      setFoods((f) => [...f, name]);
    } else {
      setOwnDrink(await customTiles('drink'));
      setNewDrink('');
      setDrinks((d) => [...d, name]);
    }
  };

  const save = async () => {
    const now = Date.now();
    for (const category of foods) {
      await addIntake({ timestamp: now, meal, kind: 'food', category, amount: 1 });
    }
    for (const category of drinks) {
      await addIntake({ timestamp: now, meal, kind: 'drink', category, amount: 1 });
    }
    if (waterGlasses > 0) {
      await addIntake({ timestamp: now, meal, kind: 'drink', category: 'water', amount: waterGlasses });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.back();
  };

  const nothingPicked = foods.length === 0 && drinks.length === 0 && waterGlasses === 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md }}
    >
      <Card>
        <SectionTitle>Wann?</SectionTitle>
        <Row>
          {MEALS.map((m) => (
            <Chip key={m} label={MEAL_LABELS[m]} selected={meal === m} onPress={() => setMeal(m)} />
          ))}
        </Row>
      </Card>

      <Card>
        <SectionTitle>Wasser</SectionTitle>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <Pressable
            onPress={() => setWaterGlasses((g) => Math.max(0, g - 1))}
            accessibilityRole="button"
            accessibilityLabel="Ein Glas weniger"
            style={{ padding: 10 }}
          >
            <Text style={{ fontSize: 30, color: t.primary }}>−</Text>
          </Pressable>
          <Text style={{ fontSize: 30, fontWeight: '700', color: t.text, minWidth: 40, textAlign: 'center' }}>
            {waterGlasses}
          </Text>
          <Pressable
            onPress={() => setWaterGlasses((g) => g + 1)}
            accessibilityRole="button"
            accessibilityLabel="Ein Glas mehr"
            style={{ padding: 10 }}
          >
            <Text style={{ fontSize: 30, color: t.primary }}>+</Text>
          </Pressable>
          <Muted>Gläser</Muted>
        </View>
      </Card>

      <Card>
        <SectionTitle>Gegessen</SectionTitle>
        <Row>
          {FOOD_CATEGORIES.map((c) => (
            <Chip
              key={c.key}
              label={c.label}
              selected={foods.includes(c.key)}
              onPress={() => toggle(foods, setFoods, c.key)}
            />
          ))}
          {ownFood.map((c) => (
            <Chip
              key={`own-${c.id}`}
              label={c.label}
              selected={foods.includes(c.label)}
              onPress={() => toggle(foods, setFoods, c.label)}
            />
          ))}
        </Row>
        <OwnTileInput
          value={newFood}
          onChange={setNewFood}
          onSubmit={() => addOwn('food', newFood)}
        />
      </Card>

      <Card>
        <SectionTitle>Getrunken</SectionTitle>
        <Row>
          {DRINK_CATEGORIES.filter((c) => c.key !== 'water').map((c) => (
            <Chip
              key={c.key}
              label={c.label}
              selected={drinks.includes(c.key)}
              onPress={() => toggle(drinks, setDrinks, c.key)}
            />
          ))}
          {ownDrink.map((c) => (
            <Chip
              key={`own-${c.id}`}
              label={c.label}
              selected={drinks.includes(c.label)}
              onPress={() => toggle(drinks, setDrinks, c.label)}
            />
          ))}
        </Row>
        <OwnTileInput
          value={newDrink}
          onChange={setNewDrink}
          onSubmit={() => addOwn('drink', newDrink)}
        />
      </Card>

      <PrimaryButton title="Speichern" onPress={save} disabled={nothingPicked} />
    </ScrollView>
  );
}

/** Eigene Kachel anlegen - inline, damit es auch auf Android funktioniert. */
function OwnTileInput({
  value, onChange, onSubmit,
}: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
        placeholder="Eigene Kachel, z. B. Hafermilch"
        placeholderTextColor={t.textMuted}
        accessibilityLabel="Eigene Kachel anlegen"
        style={{
          flex: 1, fontSize: 16, color: t.text, backgroundColor: t.bg,
          borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
        }}
      />
      <Pressable onPress={onSubmit} accessibilityRole="button" style={{ padding: 8 }}>
        <Text style={{ fontSize: 16, color: t.primary }}>Hinzufügen</Text>
      </Pressable>
    </View>
  );
}
