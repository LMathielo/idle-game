import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BottomTabBar, type BottomTabBarProps, Tabs } from 'expo-router/js-tabs';
import { StyleSheet, View } from 'react-native';
import { useGameSelector } from '../../client/GameProvider';
import { ACTIVITY_STRIP_HEIGHT, ActivityStrip } from '../../components/ActivityStrip';
import type { GameState } from '../../engine';
import { UnlockBanner } from '../../components/UnlockBanner';
import { colors, fonts } from '../../theme';

/**
 * Tab bar with the running-activity strip floating above it. The strip is absolutely positioned,
 * so starting/stopping an activity never changes the tab bar height or the screen size.
 */
function TabBarWithStrip(props: BottomTabBarProps) {
  return (
    <View style={styles.tabBarWrap}>
      <BottomTabBar {...props} />
      <ActivityStrip />
      {/* Sits above the strip's slot, whether or not an activity runs. */}
      <UnlockBanner position={styles.banner} />
    </View>
  );
}

const renderTabBar = (props: BottomTabBarProps) => <TabBarWithStrip {...props} />;

/** Points to spend: the Hero tab's badge. A number, so the layout re-renders only when it changes (not every tick). */
const selectUnspent = (s: GameState) => s.character.unspentPoints;

export default function TabsLayout() {
  const unspent = useGameSelector(selectUnspent);
  return (
    <Tabs
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.parchmentDark,
        tabBarStyle: {
          backgroundColor: colors.woodDark,
          borderTopWidth: 3,
          borderTopColor: colors.wood,
        },
        tabBarLabelStyle: { fontFamily: fonts.title, fontSize: 14 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Village',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="castle" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="hero"
        options={{
          title: 'Hero',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="shield-account" color={color as string} size={size} />,
          tabBarBadge: unspent > 0 ? unspent : undefined,
          tabBarBadgeStyle: styles.badge,
          tabBarAccessibilityLabel: unspent > 0 ? `Hero, ${unspent} attribute points to spend` : 'Hero',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Render over the screens (the strip sticks out above this view) and never clip it.
  tabBarWrap: { overflow: 'visible', zIndex: 1, elevation: 8 },
  banner: { bottom: '100%', marginBottom: ACTIVITY_STRIP_HEIGHT + 8 },
  badge: { backgroundColor: colors.gold, color: colors.ink, fontFamily: fonts.bodyBold, fontSize: 11, borderRadius: 0 },
});
