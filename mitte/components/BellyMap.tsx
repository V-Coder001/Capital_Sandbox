import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { LOCATION_LABELS, LOCATIONS } from '../src/types';
import type { Location } from '../src/types';
import { useTheme } from '../src/theme';

type Props = {
  selected?: Location[];
  onToggle?: (l: Location) => void;
  /** Wie oft jedes Feld getroffen wurde - faerbt die Felder als Heatmap ein. */
  heat?: Record<string, number>;
};

/**
 * Bauchkarte als 3x3-Raster. Die aeusseren Ecken sind staerker gerundet,
 * damit die Flaeche als Bauch lesbar wird, ohne eine eigene Illustration zu brauchen.
 */
export function BellyMap({ selected = [], onToggle, heat }: Props) {
  const t = useTheme();
  const max = heat ? Math.max(1, ...Object.values(heat)) : 1;
  const corners = [22, 0, 22, 0, 0, 0, 26, 0, 26];

  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
      accessibilityRole="none"
      accessibilityLabel="Bauchkarte, neun Felder"
    >
      {LOCATIONS.map((loc, i) => {
        const isSelected = selected.includes(loc);
        const intensity = heat ? (heat[loc] ?? 0) / max : 0;
        const bg = heat
          ? intensity === 0
            ? t.card
            : t.primarySoft
          : isSelected
            ? t.primarySoft
            : t.card;

        const corner = corners[i];
        return (
          <Pressable
            key={loc}
            disabled={!onToggle}
            onPress={() => onToggle?.(loc)}
            accessibilityRole={onToggle ? 'checkbox' : 'text'}
            accessibilityState={onToggle ? { checked: isSelected } : undefined}
            accessibilityLabel={
              heat
                ? `${LOCATION_LABELS[loc]}: ${heat[loc] ?? 0} Einträge`
                : LOCATION_LABELS[loc]
            }
            style={{
              width: '31.5%',
              aspectRatio: 1,
              borderRadius: 10,
              borderTopLeftRadius: i === 0 ? corner : 10,
              borderTopRightRadius: i === 2 ? corner : 10,
              borderBottomLeftRadius: i === 6 ? corner : 10,
              borderBottomRightRadius: i === 8 ? corner : 10,
              borderWidth: 1.5,
              borderColor: isSelected ? t.primary : t.line,
              backgroundColor: bg,
              opacity: heat && intensity > 0 ? 0.45 + intensity * 0.55 : 1,
              alignItems: 'center',
              justifyContent: 'center',
              padding: 4,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                textAlign: 'center',
                color: isSelected ? t.primary : t.textMuted,
              }}
            >
              {LOCATION_LABELS[loc].replace('Oberbauch ', 'oben ').replace('Unterbauch ', 'unten ')}
            </Text>
            {heat && (heat[loc] ?? 0) > 0 ? (
              <Text style={{ fontSize: 15, fontWeight: '600', color: t.text, marginTop: 2 }}>
                {heat[loc]}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
