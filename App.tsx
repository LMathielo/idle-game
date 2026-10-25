import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

export default function App() {
  // Tiny idle tick so we can see the app is alive on-device.
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Idle Game</Text>
      <Text style={styles.subtitle}>Hello world from mobile 📱⚔️</Text>
      <Text style={styles.ticker}>Idle for {seconds}s</Text>
      <Text style={styles.meta}>Running on {Platform.OS}</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1b1410',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: { color: '#e8c872', fontSize: 32, fontWeight: '700' },
  subtitle: { color: '#f3ead8', fontSize: 18 },
  ticker: { color: '#f3ead8', fontSize: 16, marginTop: 16, fontVariant: ['tabular-nums'] },
  meta: { color: '#9c8f7a', fontSize: 12, marginTop: 24 },
});
