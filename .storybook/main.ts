import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: [
    "../ui/**/*.stories.@(ts|tsx)",
    "../frontend/src/**/*.stories.@(ts|tsx)",
    "../design-system/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
    "@storybook/addon-a11y",
    "@chromatic-com/storybook",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (config) => {
    const replacement = fileURLToPath(new URL("../frontend/src", import.meta.url));
    if (Array.isArray(config.resolve?.alias)) {
      return {
        ...config,
        resolve: {
          ...config.resolve,
          alias: [...config.resolve.alias, { find: "@", replacement }],
        },
      };
    }
    return {
      ...config,
      resolve: {
        ...config.resolve,
        alias: { ...(config.resolve?.alias ?? {}), "@": replacement },
      },
    };
  },
};

export default config;
