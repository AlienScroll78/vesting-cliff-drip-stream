import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_SOURCES = [
  "design-system/tokens/tokens.css",
  "design-system/tokens/typography.css",
];
const OUTPUTS = {
  tokens: "design-system/tokens/tokens.json",
  inventory: "design-system/inventory.json",
  screens: "design-system/screens.json",
  flows: "design-system/flows.json",
};

function absolute(relativePath) {
  return path.join(ROOT, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(absolute(relativePath), "utf8");
}

function stripComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
}

function parseDeclarations(css) {
  const declarations = new Map();
  const expression = /--([\w-]+)\s*:\s*([\s\S]*?);/g;
  let match;
  while ((match = expression.exec(css)) !== null) {
    declarations.set(match[1], stripComments(match[2]));
  }
  return declarations;
}

function rootDeclarations(relativePath) {
  const css = read(relativePath);
  const start = css.indexOf(":root");
  if (start === -1) return parseDeclarations(css);
  const themeStart = css.indexOf("[data-theme='light']");
  return parseDeclarations(themeStart > start ? css.slice(start, themeStart) : css.slice(start));
}

function lightDeclarations(relativePath) {
  const css = read(relativePath);
  const start = css.indexOf("[data-theme='light']");
  return start === -1 ? new Map() : parseDeclarations(css.slice(start));
}

function tokenType(name, value) {
  if (name.startsWith("color-") || /^#|^(rgb|hsl|oklch|color)\(/i.test(value)) return "color";
  if (name.startsWith("font-family-")) return "fontFamily";
  if (name.startsWith("font-weight-")) return "fontWeight";
  if (name.startsWith("line-height-")) return "number";
  if (name.startsWith("letter-spacing-") || name.startsWith("measure-")) return "dimension";
  if (name.startsWith("transition-")) return "duration";
  if (name.startsWith("shadow-")) return "shadow";
  if (name.startsWith("space-") || name.startsWith("radius-") || name.startsWith("font-size-")) return "dimension";
  return "string";
}

function tokenPath(name) {
  return name.split("-").filter(Boolean);
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function nestTokens(declarations) {
  const result = {};
  for (const [name, value] of [...declarations.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = tokenPath(name);
    let cursor = result;
    for (const part of parts.slice(0, -1)) {
      cursor[part] ??= {};
      cursor = cursor[part];
    }
    cursor[parts[parts.length - 1]] = {
      $type: tokenType(name, value),
      $value: value,
      $description: `Generated from --${name}`,
    };
  }
  return sortObject(result);
}

function createTokensManifest() {
  const dark = new Map();
  const light = new Map();
  for (const source of TOKEN_SOURCES) {
    for (const [name, value] of rootDeclarations(source)) dark.set(name, value);
  }
  for (const [name, value] of lightDeclarations("design-system/tokens/tokens.css")) light.set(name, value);
  return {
    format: "DTCG",
    version: 1,
    source: TOKEN_SOURCES,
    themes: {
      dark: nestTokens(dark),
      light: nestTokens(new Map([...dark, ...light])),
    },
  };
}

function filesBelow(directory, extension) {
  const result = [];
  const absoluteDirectory = absolute(directory);
  if (!fs.existsSync(absoluteDirectory)) return result;
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const entryPath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(path.relative(ROOT, entryPath), extension));
    else if (entry.name.endsWith(extension)) result.push(path.relative(ROOT, entryPath));
  }
  return result;
}

function storyTitles() {
  const files = [
    ...filesBelow("ui", ".stories.tsx"),
    ...filesBelow("design-system", ".stories.tsx"),
    ...filesBelow("frontend/src", ".stories.tsx"),
  ];
  return files.flatMap((file) => {
    const titles = [];
    const expression = /title:\s*["']([^"']+)["']/g;
    let match;
    while ((match = expression.exec(read(file))) !== null) titles.push({ file, title: match[1] });
    return titles;
  });
}

const COMPONENTS = [
  { name: "Button", kind: "primitive", source: "design-system/components/components.css", classes: ["btn", "btn--primary", "btn--secondary", "btn--danger"], variants: ["primary", "secondary", "danger"], sizes: ["sm", "default", "lg"], states: ["default", "hover", "focus", "disabled"] },
  { name: "Input", kind: "primitive", source: "design-system/components/components.css", classes: ["input", "input--error"], variants: ["default", "error"], sizes: [], states: ["default", "focus", "disabled", "error"] },
  { name: "Select", kind: "primitive", source: "design-system/components/components.css", classes: ["select", "select--error"], variants: ["default", "error"], sizes: [], states: ["default", "focus", "disabled", "error"] },
  { name: "Card", kind: "composite", source: "design-system/components/components.css", classes: ["card", "card__header", "card__body", "card__footer"], variants: [], sizes: [], states: ["default"] },
  { name: "Badge", kind: "primitive", source: "design-system/components/components.css", classes: ["ds-badge", "ds-badge--neutral", "ds-badge--primary", "ds-badge--success", "ds-badge--warning", "ds-badge--danger"], variants: ["neutral", "primary", "success", "warning", "danger"], sizes: [], states: ["default"] },
  { name: "Tooltip", kind: "primitive", source: "design-system/components/components.css", classes: ["ds-tooltip", "ds-tooltip__content"], variants: [], sizes: [], states: ["hidden", "hover", "focus"] },
  { name: "Modal", kind: "composite", source: "design-system/components/components.css", classes: ["ds-modal-backdrop", "ds-modal", "ds-modal__header", "ds-modal__body", "ds-modal__footer"], variants: [], sizes: [], states: ["default", "open", "error"] },
  { name: "Toast", kind: "composite", source: "design-system/components/components.css", classes: ["ds-toast-region", "ds-toast", "ds-toast--success", "ds-toast--warning", "ds-toast--danger"], variants: ["success", "warning", "danger"], sizes: [], states: ["default", "success", "warning", "danger"] },
  { name: "StreamStatusBadge", kind: "composite", source: "frontend/src/components/StreamStatusBadge.tsx", classes: [], variants: ["active", "pre-cliff", "completed", "cancelled"], sizes: [], states: ["default"] },
  { name: "ScheduleCard", kind: "composite", source: "ui/components.tsx", classes: [], variants: [], sizes: [], states: ["default", "loading", "error", "long-name"] },
  { name: "ClaimButton", kind: "composite", source: "ui/components.tsx", classes: [], variants: [], sizes: [], states: ["ready", "pre-cliff", "loading", "success", "error"] },
  { name: "TimelineChart", kind: "composite", source: "ui/components.tsx", classes: [], variants: [], sizes: [], states: ["default", "pre-cliff", "complete"] },
  { name: "ClaimBottomSheet", kind: "composite", source: "frontend/src/components/ClaimBottomSheet.tsx", classes: [], variants: [], sizes: [], states: ["ready", "pre-cliff", "loading", "success", "error"] },
  { name: "StreamCreateForm", kind: "composite", source: "frontend/src/components/StreamCreateForm.tsx", classes: [], variants: ["simple", "advanced"], sizes: [], states: ["empty", "validation-error", "preview", "submitting", "success"] },
  { name: "CreateStreamWizard", kind: "composite", source: "frontend/src/wizard/CreateStreamWizard.tsx", classes: [], variants: [], sizes: [], states: ["recipient", "token", "schedule", "review"] },
  { name: "WalletButton", kind: "composite", source: "frontend/src/components/WalletButton.tsx", classes: [], variants: [], sizes: [], states: ["disconnected", "connecting", "connected", "error"] },
  { name: "CancelConfirmModal", kind: "composite", source: "frontend/src/components/CancelConfirmModal.tsx", classes: [], variants: [], sizes: [], states: ["default", "confirming", "error"] },
  { name: "Skeletons", kind: "primitive", source: "frontend/src/components/Skeletons.tsx", classes: [], variants: [], sizes: [], states: ["loading"] },
  { name: "EmptyStates", kind: "composite", source: "frontend/src/components/EmptyStates.tsx", classes: [], variants: [], sizes: [], states: ["empty", "error"] },
  { name: "StatusBadge", kind: "composite", source: "frontend/src/components/StatusBadge.tsx", classes: [], variants: ["active", "pre-cliff", "completed", "cancelled"], sizes: [], states: ["default"] },
  { name: "Table", kind: "composite", source: "frontend/src/app/admin/page.tsx", classes: [], variants: [], sizes: [], states: ["loading", "empty", "populated", "error"] },
];

function componentManifest() {
  const stories = storyTitles();
  return {
    version: 1,
    source: "design-system and frontend component sources",
    components: COMPONENTS.map((component) => {
      const sourceText = fs.existsSync(absolute(component.source)) ? read(component.source) : "";
      const tokens = new Set();
      for (const match of sourceText.matchAll(/var\((--[\w-]+)/g)) tokens.add(match[1]);
      const matchingStory = stories.find((story) => {
        const parts = story.title.split("/");
        const last = parts[parts.length - 1]?.toLowerCase() ?? "";
        return last === component.name.toLowerCase();
      });
      return {
        name: component.name,
        figmaComponentName: `Vesting/${component.name}`,
        kind: component.kind,
        source: component.source,
        cssClasses: component.classes,
        variants: component.variants,
        sizes: component.sizes,
        states: component.states,
        tokensUsed: [...tokens].sort(),
        storybookTitle: matchingStory?.title ?? null,
        accessibility: {
          focusVisible: true,
          minimumTouchTarget: "44px",
          reducedMotionAware: component.name === "ClaimBottomSheet" || component.name === "StreamCreateForm",
        },
      };
    }),
  };
}

const SCREENS = [
  { id: "landing", name: "Landing", route: "/", source: "frontend/src/app/page.tsx", layout: "landing", components: ["WalletButton", "StatusBadge"], flowIds: [], notes: "Entry point with stream overview and wallet connection." },
  { id: "stream-dashboard", name: "Stream Dashboard", route: "/streams", source: "frontend/src/app/streams/page.tsx", layout: "dashboard", components: ["ScheduleCard", "ClaimButton", "TimelineChart", "WalletButton"], flowIds: ["claim-flow", "create-flow"], notes: "Sponsor stream list, status filters, progress, and transaction actions." },
  { id: "create-stream", name: "Create Stream", route: "/", source: "frontend/src/components/StreamCreateForm.tsx", layout: "form", components: ["StreamCreateForm", "CreateStreamWizard", "Button", "Input"], flowIds: ["create-flow"], notes: "Progressive disclosure form and wizard are the canonical create entry points." },
  { id: "sponsor-dashboard", name: "Sponsor Dashboard", route: "/sponsor", source: "frontend/src/app/sponsor/page.tsx", layout: "dashboard", components: ["Card", "ScheduleCard", "Button"], flowIds: ["create-flow"], notes: "Cost calculator and sponsor-level stream overview." },
  { id: "stream-explorer", name: "Stream Explorer", route: "/view/[recipient]", source: "frontend/src/app/view/[recipient]/ViewPageClient.tsx", layout: "detail", components: ["ScheduleCard", "TimelineChart", "ClaimButton"], flowIds: ["claim-flow"], notes: "Public recipient view with schedule and claim state." },
  { id: "admin-panel", name: "Admin Panel", route: "/admin", source: "frontend/src/app/admin/page.tsx", layout: "table", components: ["Table", "Badge", "Button"], flowIds: [], notes: "Allowlist, fee, and stream administration." },
  { id: "settings", name: "Settings", route: "/notifications", source: "frontend/src/app/notifications/page.tsx", layout: "settings", components: ["Input", "Button", "Toast"], flowIds: [], notes: "Notification and wallet settings surface; no dedicated /settings route exists." },
  { id: "not-found", name: "404", route: "/404", source: "frontend/src/components/ErrorPages.tsx", layout: "error", components: ["Button"], flowIds: [], notes: "Not-found page is a component without a dedicated route file." },
];

function screensManifest() {
  return {
    version: 1,
    breakpoints: [375, 1440],
    source: "frontend/src/app and frontend/src/components route entrypoints",
    screens: SCREENS.map((screen) => ({
      ...screen,
      figmaFrameNames: [`Screen/${screen.name}/Desktop-1440`, `Screen/${screen.name}/Mobile-375`],
      states: ["loading", "empty", "error", "populated"],
    })),
  };
}

const FLOWS = {
  version: 1,
  source: "docs/flows.md and frontend/src/wizard",
  flows: [
    {
      id: "create-flow",
      name: "Create stream",
      figmaFlowName: "Prototype/Create stream",
      nodes: [
        { id: "recipient", label: "Recipient", figmaNodeName: "Create/Recipient", source: "frontend/src/wizard/StepRecipient.tsx" },
        { id: "token", label: "Token", figmaNodeName: "Create/Token", source: "frontend/src/wizard/StepSelectToken.tsx" },
        { id: "schedule", label: "Schedule", figmaNodeName: "Create/Schedule", source: "frontend/src/wizard/StepSchedule.tsx" },
        { id: "review", label: "Review", figmaNodeName: "Create/Review", source: "frontend/src/wizard/StepReview.tsx" },
        { id: "created", label: "Stream created", figmaNodeName: "Create/Success", source: "frontend/src/wizard/StepReview.tsx" },
      ],
      edges: [
        { from: "recipient", to: "token", trigger: "Next" },
        { from: "token", to: "schedule", trigger: "Next" },
        { from: "schedule", to: "review", trigger: "Review" },
        { from: "review", to: "created", trigger: "Confirm and sign" },
        { from: "schedule", to: "schedule", trigger: "Back" },
      ],
    },
    {
      id: "claim-flow",
      name: "Claim vested tokens",
      figmaFlowName: "Prototype/Claim tokens",
      nodes: [
        { id: "pre-cliff", label: "Pre-cliff", figmaNodeName: "Claim/Pre-cliff", source: "docs/mobile-claim-bottom-sheet.md" },
        { id: "ready", label: "Claimable", figmaNodeName: "Claim/Ready", source: "frontend/src/components/ClaimBottomSheet.tsx" },
        { id: "loading", label: "Submitting", figmaNodeName: "Claim/Loading", source: "frontend/src/components/ClaimBottomSheet.tsx" },
        { id: "success", label: "Claimed", figmaNodeName: "Claim/Success", source: "frontend/src/components/ClaimBottomSheet.tsx" },
        { id: "error", label: "Retry", figmaNodeName: "Claim/Error", source: "frontend/src/components/ClaimBottomSheet.tsx" },
      ],
      edges: [
        { from: "pre-cliff", to: "ready", trigger: "Current ledger reaches cliff" },
        { from: "ready", to: "loading", trigger: "Claim tokens" },
        { from: "loading", to: "success", trigger: "Transaction confirmed" },
        { from: "loading", to: "error", trigger: "Transaction rejected" },
        { from: "error", to: "loading", trigger: "Retry" },
      ],
    },
  ],
};

function checkOrWrite(name, value) {
  const target = absolute(OUTPUTS[name]);
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== expected) {
      console.error(`${OUTPUTS[name]} is out of date. Run npm run design:export.`);
      process.exitCode = 1;
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, expected);
}

checkOrWrite("tokens", createTokensManifest());
checkOrWrite("inventory", componentManifest());
checkOrWrite("screens", screensManifest());
checkOrWrite("flows", FLOWS);

if (!process.argv.includes("--check")) {
  console.log(`Design manifests written to ${Object.values(OUTPUTS).join(", ")}`);
}
