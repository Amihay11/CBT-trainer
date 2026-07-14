import { registerRootComponent } from 'expo';

import App from './App';

// `registerRootComponent` calls `AppRegistry.registerComponent('main', () => App)`
// and ensures the environment is set up correctly for both Expo Go and a custom
// Dev Client build (the target runtime, since WatermelonDB/SQLCipher are native).
registerRootComponent(App);
