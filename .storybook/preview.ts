import type { Preview } from "@storybook/react";
import "../ui/styles.css";
import "../design-system/tokens/tokens.css";
import "../design-system/tokens/typography.css";
import "../design-system/components/components.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    chromatic: {
      viewports: [390, 768, 1280],
    },
    // A11y addon: run WCAG 2.0 A/AA and 2.1 AA checks on every story
    a11y: {
      config: {},
      options: {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa"],
        },
      },
    },
    docs: {
      toc: true,
    },
  },
  globalTypes: {
    colorScheme: {
      description: "Color scheme",
      defaultValue: "light",
      toolbar: {
        title: "Color scheme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const scheme = context.globals.colorScheme as string;
      return (
        <div data-color-scheme={scheme} data-theme={scheme} style={{ colorScheme: scheme }}>
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
