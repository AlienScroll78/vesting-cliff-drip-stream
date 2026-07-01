import "@testing-library/jest-dom";
import React from "react";
// Ensure React is available globally for JSX in test files
(globalThis as unknown as Record<string, unknown>).React = React;
