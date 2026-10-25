import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

type Props = {
  label: string;
  icon?: string;
  onPress?: () => void;
};

/** Wooden sign button with hard pixel bevels (no rounded corners). */
export function PixelButton({ label, icon, onPress }: Props) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <View style={[styles.outer, pressed && styles.outerPressed]}>
          <View style={[styles.inner, pressed && styles.innerPressed]}>
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
