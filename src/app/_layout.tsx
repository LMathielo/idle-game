import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Jacquard12_400Regular } from '@expo-google-fonts/jacquard-12';
import { PixelifySans_400Regular, PixelifySans_700Bold } from '@expo-google-fonts/pixelify-sans';
import { useFonts } from 'expo-font';
import { Tabs } from 'expo-router/js-tabs';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { colors, fonts } from '../theme';

export default function RootLayout() {
  const [loaded] = useFonts({ Jacquard12_400Regular, PixelifySans_400Regular, PixelifySans_700Bold });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.night }} />;

  return (
    <>
      <StatusBar style="light" />
      <Tabs
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
    </>
  );
}
