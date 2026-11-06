import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  base: './',
  plugins: [react(), federation({
    name: 'ambient_cinema', filename: 'remoteEntry.js',
    exposes: { './World': './src/index.tsx' },
    shared: {
      react: { singleton: true, requiredVersion: '^19.0.0' },
      'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      'react/jsx-runtime': { singleton: true },
      three: { singleton: true, requiredVersion: '^0.176.0' },
      '@react-three/fiber': { singleton: true, requiredVersion: '^9.0.0' },
      '@react-three/rapier': { singleton: true, requiredVersion: '^2.0.0' },
      '@react-three/drei': { singleton: true, requiredVersion: '^10.0.0' },
      // XRift's federation share key is 0.1.0, independently of the SDK npm version.
      '@xrift/world-components': { singleton: true, requiredVersion: '^0.1.0' },
    },
  })],
  build: { target: 'esnext', minify: false, cssCodeSplit: false, assetsDir: '' },
})
