import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  manifest: {
    name: 'Tesla Inventory Helper',
    description: 'Save Tesla inventory searches that stick. Watchlist + HW4 glow. Private & local.',
    permissions: ['storage', 'tabs', 'alarms', 'notifications'],
    host_permissions: [
      'https://www.tesla.com/inventory/*',
      'https://www.tesla.com/*/inventory/*',
      'https://www.tesla.com/*/order/*',
    ],
    action: { default_title: 'Tesla Inventory Helper' },
  },
});
