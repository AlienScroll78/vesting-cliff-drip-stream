import type { StorybookConfig } from "@storybook/react-vite";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendSrc = path.resolve(dirname, "../frontend/src");

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
  viteFinal: async (viteConfig) => {
    viteConfig.resolve = viteConfig.resolve ?? {};
    viteConfig.resolve.alias = {
      ...(viteConfig.resolve.alias as Record<string, string> | undefined),
      "@": frontendSrc,
    };
    return viteConfig;
  },
};

export default config;
