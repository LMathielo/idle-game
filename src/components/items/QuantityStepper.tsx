// Quantity picker shared by Buy and Sell: Min / −10 / −1 / value / +1 / +10 / Max, clamped to [1, max].
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../../theme';

type Props = { value: number; max: number; onChange: (n: number) => void };

const STEPS = [
  { label: 'Min', to: (_v: number, _max: number) => 1 },
  { label: '−10', to: (v: number) => v - 10 },
  { label: '−1', to: (v: number) => v - 1 },
  null,
  { label: '+1', to: (v: number) => v + 1 },
  { label: '+10', to: (v: number) => v + 10 },
  { label: 'Max', to: (_v: number, max: number) => max },
] as const;

export const QuantityStepper = memo(function QuantityStepper({ value, max, onChange }: Props) {
  const clamp = (n: number) => Math.max(1, Math.min(max, n));
  return (
    <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={`Quantity ${value} of ${max}`}>
      {STEPS.map((step, i) => {
        if (!step) {
          return (
            <Text key={i} style={styles.value} accessibilityLiveRegion="polite">
              {value}
            </Text>
          );
        }
        const next = clamp(step.to(value, max));
        const disabled = max < 1 || next === value;
        return (
          <Pressable
            key={i}
            onPress={() => onChange(next)}
            disabled={disabled}
            style={[styles.btn, disabled && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={`${step.label} quantity`}
            hitSlop={2}
          >
            <Text style={[styles.btnText, disabled && styles.btnTextDisabled]}>{step.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  btn: {
    minWidth: 40,
    height: 44,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.wood,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopColor: colors.woodLight,
    borderLeftColor: colors.woodLight,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomColor: colors.woodDark,
    borderRightColor: colors.woodDark,
  },
  btnDisabled: { backgroundColor: colors.slot, borderTopColor: colors.slotBorder, borderLeftColor: colors.slotBorder },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.parchment },
  btnTextDisabled: { color: colors.inkSoft },
  value: { flex: 1, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 22, color: colors.parchment },
});
