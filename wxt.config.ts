import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  manifest: {
    name: 'Tesla Inventory Helper',
    description: 'Highlights Tesla inventory cars matching configurable VIN rules.',
    permissions: ['storage'],
    host_permissions: ['https://www.tesla.com/inventory/*'],
    action: { default_title: 'Tesla Inventory Helper' },
  },
});
