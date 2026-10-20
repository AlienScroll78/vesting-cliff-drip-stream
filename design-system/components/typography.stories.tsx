import type { Meta, StoryObj } from "@storybook/react";
import { within, expect, userEvent } from "@storybook/test";

// ─── Typography ──────────────────────────────────────────────────────────────

const typographyMeta: Meta = {
  title: "Design System/Typography",
  parameters: {
    docs: {
      description: {
        component:
          "Fluid type scale using clamp(). Sizes interpolate linearly between 320px and 1280px viewport — no media-query breakpoints needed.",
      },
    },
  },
};
export default typographyMeta;

export const TypeScale: StoryObj = {
  name: "Type Scale",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: "var(--color-text-primary)" }}>
      {[
        { cls: "text-xs",   label: "text-xs  (11→12px)"  },
        { cls: "text-sm",   label: "text-sm  (13→14px)"  },
        { cls: "text-base", label: "text-base (16→18px)" },
        { cls: "text-lg",   label: "text-lg  (18→20px)"  },
        { cls: "text-xl",   label: "text-xl  (20→24px)"  },
        { cls: "text-2xl",  label: "text-2xl (24→30px)"  },
        { cls: "text-3xl",  label: "text-3xl (30→38px)"  },
        { cls: "text-4xl",  label: "text-4xl (36→48px)"  },
      ].map(({ cls, label }) => (
        <div key={cls} className={cls}>
          {label} — The quick brown fox jumps
        </div>
      ))}
    </div>
  ),
};

export const HeadingHierarchy: StoryObj = {
  name: "Heading Hierarchy",
  render: () => (
    <div style={{ color: "var(--color-text-primary)" }}>
      <h1>h1 — Create Vesting Stream</h1>
      <h2>h2 — Stream Details</h2>
      <h3>h3 — Schedule Parameters</h3>
      <h4>h4 — Token Information</h4>
      <p>Body paragraph — The cliff ensures recipients remain aligned with the project before unlocking value. All tokens drip linearly after the cliff is reached.</p>
    </div>
  ),
};

export const MonospaceAmounts: StoryObj = {
  name: "Monospace Amounts & Addresses",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: "var(--color-text-primary)" }}>
      <div>
        <div className="label-caps" style={{ marginBottom: 4 }}>Claimable amount</div>
        <div className="amount-display">12 450.750000 USDC</div>
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 4 }}>Stellar address</div>
        <div className="ds-address">GBMV7NXFQRPE3JPPKH5NBZZ4K5RVPWUXRYJDGZ4JPXFHFHSBK3Q3YMR</div>
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 4 }}>Ledger number</div>
        <div className="ds-ledger">48 291 774</div>
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 4 }}>Transaction hash</div>
        <div className="ds-tx-hash">a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2</div>
      </div>
    </div>
  ),
};
