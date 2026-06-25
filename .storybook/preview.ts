import type { Preview } from "@storybook/react";
import "../ui/styles.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    chromatic: {
      viewports: [390, 768, 1280]
    }
  }
};

export default preview;
