import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { radius, spacing, useTheme } from '../src/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.card,
          borderRadius: radius,
          padding: spacing.md,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text style={{ fontSize: 20, fontWeight: '600', color: t.text, marginBottom: spacing.sm }}>
      {children}
    </Text>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={{ fontSize: 15, color: t.textMuted, lineHeight: 22 }}>{children}</Text>;
}

export function Chip({
  label, selected, onPress,
}: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: selected ? t.primary : t.line,
        backgroundColor: selected ? t.primarySoft : 'transparent',
        marginRight: spacing.xs,
        marginBottom: spacing.xs,
      }}
    >
      <Text style={{ fontSize: 16, color: selected ? t.primary : t.text }}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  title, onPress, disabled,
}: { title: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        backgroundColor: disabled ? t.line : t.primary,
        opacity: pressed ? 0.85 : 1,
        borderRadius: radius,
        paddingVertical: 18,
        alignItems: 'center',
      })}
    >
      <Text style={{ color: disabled ? t.textMuted : '#FFFFFF', fontSize: 18, fontWeight: '600' }}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});
