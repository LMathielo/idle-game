import type { Ref } from 'react';
import { type HostInstance, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { PRESS_IN_DELAY_MS, type RepeatAction, useHoldRepeat } from './ui/useHoldRepeat';

type Props = {
  label: string;
  icon?: string;
  onPress?: () => void;
  /** Highlighted (e.g. the running activity). */
  active?: boolean;
  /** Greyed out and not pressable. */
  disabled?: boolean;
  /** Greyed out but still pressable (e.g. a locked building's sign, which opens its Build sheet). */
  muted?: boolean;
  /** Spoken instead of `label` when the visible text is not enough. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Smaller second line under the label (e.g. a cost). */
  sublabel?: string;
  /** Takes an equal share of a row (flex: 1) with centered text, for button rows that must not wrap. */
  stretch?: boolean;
  /** Village sign: pixel title font. Other buttons use the readable body font. */
  sign?: boolean;
  /**
   * Hold-to-repeat (useHoldRepeat): a tap acts once; holding acts, waits 400 ms, then repeats every 100 ms until
   * release, a rejected action (return false), `disabled`, or unmount. Replaces `onPress`. Ticks after the first get
   * `{ repeat: true }`: never ask for confirmation on those.
   */
  repeat?: RepeatAction;
  /** The pressable's host view (InfoPopover measures it to anchor next to the button). */
  ref?: Ref<HostInstance>;
};

/** Wooden sign button with hard pixel bevels (no rounded corners). */
export function PixelButton({ label, icon, onPress, active, disabled, muted, accessibilityLabel, accessibilityHint, sublabel, stretch, sign, repeat, ref }: Props) {
  const grey = disabled || muted;
  const hold = useHoldRepeat(repeat, !!repeat && !disabled);
  const pressProps = repeat
    ? { onPressIn: hold.onPressIn, onPressOut: hold.onPressOut, onPress: hold.onPress, unstable_pressDelay: PRESS_IN_DELAY_MS }
    : { onPress };
  return (
    <Pressable
      ref={ref}
      {...pressProps}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint ?? (repeat ? 'Hold to repeat' : undefined)}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      hitSlop={6}
      style={stretch ? styles.stretch : undefined}
    >
      {({ pressed }) => (
        <View style={[styles.outer, active && styles.outerActive, pressed && styles.outerPressed, grey && styles.outerDisabled]}>
          <View
            style={[
              styles.inner,
              (stretch || sublabel) && styles.innerStacked,
              active && styles.innerActive,
              pressed && styles.innerPressed,
              grey && styles.innerDisabled,
            ]}
          >
            {icon ? <Text style={styles.icon}>{icon}</Text> : null}
            <Text style={[styles.label, sign && styles.labelSign, grey && styles.labelDisabled]} numberOfLines={1}>
              {label}
            </Text>
            {sublabel ? (
              <Text style={[styles.sublabel, grey && styles.labelDisabled]} numberOfLines={1}>
                {sublabel}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: {
    backgroundColor: colors.woodDark,
    padding: 3,
    // hard drop shadow, pixel style
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.6,
    shadowRadius: 0,
    elevation: 4,
  },
  outerActive: { backgroundColor: colors.gold },
  outerPressed: { transform: [{ translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // 44pt tap target with the 3pt outer frame
    minHeight: 38,
    backgroundColor: colors.wood,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopColor: colors.woodLight,
    borderLeftColor: colors.woodLight,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomColor: colors.woodDark,
    borderRightColor: colors.woodDark,
  },
  innerActive: { backgroundColor: colors.skill, borderTopColor: '#7cc576', borderLeftColor: '#7cc576' },
  innerPressed: { backgroundColor: colors.woodDark },
  outerDisabled: { shadowOpacity: 0, elevation: 0 },
  innerDisabled: { backgroundColor: colors.slot, borderTopColor: colors.slotBorder, borderLeftColor: colors.slotBorder },
  icon: { fontSize: 14 },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.gold,
    textShadowColor: colors.woodDark,
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  labelSign: { fontFamily: fonts.title, fontSize: 18 },
  stretch: { flex: 1 },
  innerStacked: { flexDirection: 'column', justifyContent: 'center', gap: 0, paddingHorizontal: 4 },
  sublabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.parchment },
  labelDisabled: { color: colors.parchmentDark, opacity: 0.6 },
});
