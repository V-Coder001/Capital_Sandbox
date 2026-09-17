import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { painColor, useTheme } from '../src/theme';

type Props = { value: number; onChange: (v: number) => void };

/**
 * VAS-Slider 0-100. Bedienung nur durch Wischen, die Zahl steht immer daneben -
 * der Farbverlauf allein waere nicht barrierefrei.
 */
export function VasSlider({ value, onChange }: Props) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const lastStep = useRef(Math.round(value / 10));

  const set = (x: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const next = Math.round(Math.max(0, Math.min(1, x / w)) * 100);
    const step = Math.round(next / 10);
    if (step !== lastStep.current) {
      lastStep.current = step;
      Haptics.selectionAsync().catch(() => {});
    }
    onChange(next);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
      onPanResponderMove: (e) => set(e.nativeEvent.locationX),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const color = painColor(value, t);
  const knobX = width * (value / 100);

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ fontSize: 13, color: t.textMuted }}>kein Schmerz</Text>
        <Text style={{ fontSize: 13, color: t.textMuted }}>stärkster vorstellbarer</Text>
      </View>

      <View
        {...responder.panHandlers}
        onLayout={onLayout}
        accessibilityRole="adjustable"
        accessibilityLabel="Schmerzstärke"
        accessibilityValue={{ min: 0, max: 10, now: Math.round(value / 10) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const delta = e.nativeEvent.actionName === 'increment' ? 10 : -10;
          onChange(Math.max(0, Math.min(100, value + delta)));
        }}
        style={{ height: 44, justifyContent: 'center' }}
      >
        <View style={{ height: 10, borderRadius: 5, backgroundColor: t.line }}>
          <View
            style={{
              height: 10,
              width: knobX,
              borderRadius: 5,
              backgroundColor: color,
            }}
          />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: Math.max(0, knobX - 16),
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: t.card,
            borderWidth: 3,
            borderColor: color,
          }}
        />
      </View>

      <Text style={{ fontSize: 34, fontWeight: '700', color: t.text, textAlign: 'center' }}>
        {(value / 10).toFixed(1)}
      </Text>
    </View>
  );
}
