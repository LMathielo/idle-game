// Village → Town Hall (once built): full-screen modal. A placeholder until workers and building upgrades exist.
import { StyleSheet, Text, View } from 'react-native';
import { useGameState } from '../../client/GameProvider';
import { BUILDINGS, buildingLevel } from '../../engine';
import { colors, fonts } from '../../theme';
import { ModalScreen } from '../ModalScreen';

export function TownHallModal() {
  const state = useGameState();
  const level = buildingLevel(state, 'town_hall');
  return (
    <ModalScreen title={BUILDINGS.town_hall.name} closeLabel="Close town hall" headerRight={<Text style={styles.level}>Lv {level}</Text>}>
      <View style={styles.card}>
        <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
          {BUILDINGS.town_hall.icon}
        </Text>
        <Text style={styles.title} accessibilityRole="header">
          Coming soon
        </Text>
        <Text style={styles.body}>Automated workers and building upgrades</Text>
      </View>
    </ModalScreen>
  );
}

const styles = StyleSheet.create({
  level: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold },
  card: {
    margin: 16,
    padding: 20,
    gap: 10,
    alignItems: 'center',
    backgroundColor: colors.parchment,
    borderWidth: 3,
    borderColor: colors.parchmentDark,
  },
  icon: { fontSize: 56 },
  title: { fontFamily: fonts.title, fontSize: 26, color: colors.ink, textAlign: 'center' },
  body: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.inkSoft, textAlign: 'center' },
});
