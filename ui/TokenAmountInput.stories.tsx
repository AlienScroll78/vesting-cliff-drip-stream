import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TokenAmountInput } from "../frontend/src/components/TokenAmountInput";

const meta: Meta<typeof TokenAmountInput> = {
  title: "Components/TokenAmountInput",
  component: TokenAmountInput,
  args: {
    label: "Token amount",
    tokenSymbol: "XLM",
    onChange: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

function AmountExample({ initialValue, locale }: { initialValue: bigint; locale: string }) {
  const [value, setValue] = useState<bigint | null>(initialValue);
  return (
    <div style={{ width: 360, display: "grid", gap: 12 }}>
      <TokenAmountInput
        label={`Token amount (${locale})`}
        locale={locale}
        tokenSymbol="XLM"
        value={value}
        onChange={setValue}
      />
      <output style={{ fontFamily: "monospace", fontSize: 12 }}>
        {value === null ? "—" : `${value.toString()} stroops`}
      </output>
    </div>
  );
}

export const Default: Story = {};

export const EdgeCases: Story = {
  name: "Edge cases and large values",
  render: () => (
    <div style={{ width: 480, display: "grid", gap: 16 }}>
      <AmountExample initialValue={BigInt("15000000000000000")} locale="en-US" />
      <AmountExample initialValue={BigInt("2500000000000000")} locale="en-US" />
      <AmountExample initialValue={BigInt("450000000000")} locale="de-DE" />
      <AmountExample
        initialValue={BigInt("170141183460469231731687303715884105727")}
        locale="en-US"
      />
    </div>
  ),
};
