import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

type Props = {
  label: string;
  icon?: string;
  onPress?: () => void;
  /** Highlighted (e.g. the running activity). */
  active?: boolean;
};

/** Wooden sign button with hard pixel bevels (no rounded corners). */
export function PixelButton({ label, icon, onPress, active }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      hitSlop={6}
    >
      {({ pressed }) => (
        <View style={[styles.outer, active && styles.outerActive, pressed && styles.outerPressed]}>
          <View style={[styles.inner, active && styles.innerActive, pressed && styles.innerPressed]}>
            {icon ? <Text style={styles.icon}>{icon}</Text> : null}
            <Text style={styles.label}>{label}</Text>
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
  icon: { fontSize: 14 },
  label: {
    fontFamily: fonts.title,
    fontSize: 22,
    color: colors.gold,
    textShadowColor: colors.woodDark,
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
});
