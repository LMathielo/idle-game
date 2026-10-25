import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VillageScene } from '../components/VillageScene';
import { mockGameState } from '../mocks/gameState';
import { colors, fonts } from '../theme';

export default function VillageScreen() {
  const { character } = mockGameState;

  return (
    <View style={styles.root}>
      <VillageScene />
      {/* Top HUD over the sky */}
      <SafeAreaView edges={['top']} style={styles.hudWrap} pointerEvents="none">
        <View style={styles.hud}>
          <Text style={styles.hudName}>
            {character.name} <Text style={styles.hudLevel}>Lv {character.level}</Text>
          </Text>
          <Text style={styles.hudGold}>🪙 {character.gold.toLocaleString()}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  hudWrap: { position: 'absolute', left: 0, right: 0, top: 0 },
  hud: {
    marginHorizontal: 12,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(43, 29, 18, 0.85)',
    borderWidth: 2,
    borderColor: colors.wood,
  },
  hudName: { fontFamily: fonts.title, fontSize: 24, color: colors.parchment },
  hudLevel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  hudGold: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold },
});
