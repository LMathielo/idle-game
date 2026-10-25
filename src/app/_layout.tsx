import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Jacquard12_400Regular } from '@expo-google-fonts/jacquard-12';
import { PixelifySans_400Regular, PixelifySans_700Bold } from '@expo-google-fonts/pixelify-sans';
import { useFonts } from 'expo-font';
import { BottomTabBar, type BottomTabBarProps, Tabs } from 'expo-router/js-tabs';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { GameProvider } from '../client/GameProvider';
import { ActivityStrip } from '../components/ActivityStrip';
import { AwayModal } from '../components/AwayModal';
import { colors, fonts } from '../theme';

/**
 * Tab bar with the running-activity strip floating above it. The strip is absolutely positioned,
 * so starting/stopping an activity never changes the tab bar height or the screen size.
 */
function TabBarWithStrip(props: BottomTabBarProps) {
  return (
    <View style={styles.tabBarWrap}>
      <BottomTabBar {...props} />
      <ActivityStrip />
    </View>
  );
}

const renderTabBar = (props: BottomTabBarProps) => <TabBarWithStrip {...props} />;

export default function RootLayout() {
  const [loaded] = useFonts({ Jacquard12_400Regular, PixelifySans_400Regular, PixelifySans_700Bold });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.night }} />;

  return (
    <GameProvider>
      <StatusBar style="light" />
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
          tabBarLabelStyle: { fontFamily: fonts.title, fontSize: 18 },
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
          }}
        />
      </Tabs>
      <AwayModal />
    </GameProvider>
  );
}

const styles = StyleSheet.create({
  // Render over the screens (the strip sticks out above this view) and never clip it.
  tabBarWrap: { overflow: 'visible', zIndex: 1, elevation: 8 },
});
