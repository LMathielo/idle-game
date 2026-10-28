import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

/** Parchment panel with a dark pixel frame and a pixel-font title. */
export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.frame}>
      <View style={styles.body}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {children}
      </View>
    </View>
  );
}

/** Horizontal progress bar (HP, XP, skills). */
export function Bar({ value, max, color, label }: { value: number; max: number; color: string; label?: string }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <View style={styles.barOuter}>
      <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      {label ? <Text style={styles.barLabel}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: colors.woodDark, padding: 3, marginBottom: 12 },
  body: {
    backgroundColor: colors.parchment,
    padding: 12,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopColor: '#fff6dc',
    borderLeftColor: '#fff6dc',
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomColor: colors.parchmentDark,
    borderRightColor: colors.parchmentDark,
  },
  title: { fontFamily: fonts.title, fontSize: 20, color: colors.ink, marginBottom: 8 },
  barOuter: {
    height: 16,
    backgroundColor: colors.slot,
    borderWidth: 2,
    borderColor: colors.slotBorder,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  barLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    lineHeight: 12,
    color: '#fff',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
});
