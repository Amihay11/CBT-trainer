/**
 * App root — bootstraps the encrypted store, then renders the clinical flow.
 *
 * The UI is gated on `initializeDatabase()` so no screen can query an unmounted/unencrypted DB.
 * Bootstrap sequence:
 *   1. Fetch/generate the AES-256 key from secure hardware and mount SQLCipher WatermelonDB.
 *   2. Ensure a local patient account exists.
 *   3. Render `ThoughtRecordFlow` for that patient.
 * Any failure is surfaced (fail-closed) rather than silently degrading to an unencrypted state.
 */
import './global.css';

import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { initializeDatabase } from './src/database/database';
import { ensureLocalUser } from './src/database/repositories/userRepository';
import { ThoughtRecordFlow } from './src/components/ThoughtRecordFlow';

type BootstrapState =
  | { status: 'loading' }
  | { status: 'ready'; userId: string }
  | { status: 'error'; message: string };

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await initializeDatabase();
        const userId = await ensureLocalUser();
        if (!cancelled) setBootstrap({ status: 'ready', userId });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to initialize secure storage.';
        if (!cancelled) setBootstrap({ status: 'error', message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView className="flex-1 bg-surface">
        {bootstrap.status === 'loading' ? (
          <View className="flex-1 items-center justify-center gap-4 bg-surface" accessibilityRole="progressbar">
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text className="text-base text-muted">Securing your data…</Text>
          </View>
        ) : bootstrap.status === 'error' ? (
          <View className="flex-1 items-center justify-center gap-2 bg-surface p-6">
            <Text accessibilityRole="header" className="text-xl font-bold text-crisis">
              Secure storage unavailable
            </Text>
            <Text className="text-center text-base text-muted">{bootstrap.message}</Text>
          </View>
        ) : (
          <ThoughtRecordFlow userId={bootstrap.userId} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
