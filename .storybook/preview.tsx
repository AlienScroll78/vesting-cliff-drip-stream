import type { Preview } from "@storybook/react";
import "../ui/styles.css";
import "../design-system/tokens/tokens.css";
import "../design-system/tokens/typography.css";
import "../design-system/components/components.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    // Chromatic configuration:
    //  - `modes` capture every story in both light and dark colour schemes
    //    using the `colorScheme` global defined below.
    //  - `viewports` cover the mobile (375px) and desktop (1440px) breakpoints
    //    required by the visual-regression acceptance criteria, plus tablet.
    chromatic: {
      viewports: [375, 768, 1440],
      modes: {
        light: { globals: { colorScheme: "light" } },
        dark: { globals: { colorScheme: "dark" } },
      },
    },
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
