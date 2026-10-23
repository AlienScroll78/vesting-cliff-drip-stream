import { createRoot } from "react-dom/client";
import { OnboardingExperience } from "./components/OnboardingExperience";

const rootElement = document.getElementById("onboarding-root");

if (!rootElement) {
  throw new Error("Onboarding root element is missing from the page.");
}

createRoot(rootElement).render(
  <OnboardingExperience tourMode="create-stream" />,
);
