"use client";
import { useState, useId } from "react";
import { useWallet } from "@/contexts/WalletContext";

interface Props {
  /** SAC contract address of the selected token */
  value: string;
  /** Total deposit amount being allocated (tokens, not stroops) */
  depositAmount: number;
  onChange: (contractAddress: string) => void;
}

const CUSTOM_VALUE = "__custom__";

export function TokenBalanceSelect({ value, depositAmount, onChange }: Props) {
  const { balances, balancesLoading } = useWallet();
  const [showCustom, setShowCustom] = useState(false);
  const [customAddress, setCustomAddress] = useState("");
  const selectId = useId();
  const customId = useId();

  const selectedBalance = balances.find((b) => b.contractAddress === value);
  const isOver =
    selectedBalance !== undefined &&
    depositAmount > 0 &&
    parseFloat(selectedBalance.balance) < depositAmount;

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === CUSTOM_VALUE) {
      setShowCustom(true);
      // keep previous value until user types
    } else {
      setShowCustom(false);
      onChange(e.target.value);
    }
  }

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCustomAddress(e.target.value);
    onChange(e.target.value.trim());
  }

  return (
    <div className="token-balance-select">
      <label htmlFor={selectId} className="field-label">
        Token
      </label>

      {balancesLoading ? (
        <p className="token-balance-select__loading" aria-live="polite">
          Loading balances…
        </p>
      ) : (
        <select
          id={selectId}
          value={showCustom ? CUSTOM_VALUE : value}
          onChange={handleSelectChange}
          className="token-balance-select__select"
          aria-describedby={isOver ? "token-balance-warning" : undefined}
        >
          <option value="" disabled>
            Select token
          </option>

          {balances.map((b) => (
            <option key={b.contractAddress} value={b.contractAddress}>
              {b.assetCode} — {parseFloat(b.balance).toLocaleString(undefined, { maximumFractionDigits: 7 })} available
            </option>
          ))}

          <option value={CUSTOM_VALUE}>Enter custom address…</option>
        </select>
      )}

      {showCustom && (
        <input
          id={customId}
          type="text"
          value={customAddress}
          onChange={handleCustomChange}
          placeholder="C… contract address"
          className="token-balance-select__custom-input"
          aria-label="Custom token contract address"
          autoFocus
        />
      )}

      {isOver && (
        <p
          id="token-balance-warning"
          role="alert"
          className="token-balance-select__warning"
        >
          ⚠ Deposit ({depositAmount.toLocaleString()}) exceeds your{" "}
          {selectedBalance.assetCode} balance ({parseFloat(selectedBalance.balance).toLocaleString()}).
        </p>
      )}
    </div>
  );
}
