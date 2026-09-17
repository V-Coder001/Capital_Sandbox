import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { painColor, useTheme } from '../src/theme';
import { weekdayShort } from '../src/dates';

/** Grosser Tagesring. Die Zahl steht in der Mitte, nicht nur die Farbe. */
export function DayRing({ value, label }: { value: number | null; label: string }) {
  const t = useTheme();
  const size = 148;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = value === null ? 0 : (value / 100) * circumference;
  const color = value === null ? t.line : painColor(value, t);

  return (
    <View style={{ alignItems: 'center' }} accessibilityLabel={`${label}: ${value === null ? 'kein Eintrag' : (value / 10).toFixed(1)} von 10`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.line} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ position: 'absolute', top: 0, height: size, justifyContent: 'center' }}>
        <Text style={{ fontSize: 40, fontWeight: '700', color: t.text, textAlign: 'center' }}>
          {value === null ? '–' : (value / 10).toFixed(1)}
        </Text>
        <Text style={{ fontSize: 13, color: t.textMuted, textAlign: 'center' }}>{label}</Text>
      </View>
    </View>
  );
}

/** Weiche Linie der Tagesdurchschnitte. Punkte sind antippbar. */
export function WeekLine({
  points, onPressDay,
}: {
  points: { dayStart: number; value: number | null }[];
  onPressDay?: (dayStart: number) => void;
}) {
  const t = useTheme();
  const height = 120;
  const width = 300;
  const padding = 12;
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const y = (v: number) => padding + (1 - v / 100) * (height - padding * 2);

  const coords = points.map((p, i) => ({
    x: padding + i * stepX,
    y: p.value === null ? null : y(p.value),
  }));

  let d = '';
  coords.forEach((c, i) => {
    if (c.y === null) return;
    const prev = coords[i - 1];
    if (!d || !prev || prev.y === null) {
      d += `M ${c.x} ${c.y}`;
    } else {
      const mid = (prev.x + c.x) / 2;
      d += ` C ${mid} ${prev.y}, ${mid} ${c.y}, ${c.x} ${c.y}`;
    }
  });

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {d ? <Path d={d} stroke={t.primary} strokeWidth={3} fill="none" strokeLinecap="round" /> : null}
        {coords.map((c, i) =>
          c.y === null ? null : (
            <Circle key={i} cx={c.x} cy={c.y} r={5} fill={painColor(points[i].value!, t)} />
          ),
        )}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {points.map((p) => (
          <Pressable
            key={p.dayStart}
            onPress={() => onPressDay?.(p.dayStart)}
            accessibilityRole="button"
            accessibilityLabel={`${weekdayShort(p.dayStart)}: ${p.value === null ? 'kein Eintrag' : (p.value / 10).toFixed(1)}`}
            style={{ flex: 1, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 12, color: t.textMuted }}>{weekdayShort(p.dayStart)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
