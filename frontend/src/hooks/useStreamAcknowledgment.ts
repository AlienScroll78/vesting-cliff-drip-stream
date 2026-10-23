import { useCallback, useEffect, useState } from "react";
import { VestingStream } from "@/types";
import { signWithFreighter } from "@/utils/freighterSignMessage";
import {
  SignMessageFn,
  StreamAcknowledgment,
  buildAcknowledgmentMessage,
  fetchAcknowledgments,
  submitAcknowledgment,
} from "@/utils/streamAcknowledgments";

export type AcknowledgmentPhase = "loading" | "pending" | "resolved" | "error";

export interface UseStreamAcknowledgmentResult {
  phase: AcknowledgmentPhase;
  record: StreamAcknowledgment | null;
  error: string | null;
  busy: boolean;
  acknowledge: () => Promise<void>;
  skip: () => Promise<void>;
}

function findRecord(
  items: StreamAcknowledgment[],
  stream: VestingStream,
): StreamAcknowledgment | null {
  return (
    items.find(
      (item) => item.sponsor === stream.sponsor && item.token === stream.token,
    ) ?? null
  );
}

export function useStreamAcknowledgment(
  stream: VestingStream,
  network = "testnet",
  signMessage: SignMessageFn = signWithFreighter,
): UseStreamAcknowledgmentResult {
  const [phase, setPhase] = useState<AcknowledgmentPhase>("loading");
  const [record, setRecord] = useState<StreamAcknowledgment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { recipient, sponsor, token } = stream;

  useEffect(() => {
    let active = true;

    fetchAcknowledgments(recipient)
      .then((items) => {
        if (!active) return;
        const found = findRecord(items, stream);
        setRecord(found);
        setPhase(found === null || found.pending ? "pending" : "resolved");
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load acknowledgments");
        setPhase("pending");
      });

    return () => {
      active = false;
    };
  }, [recipient, sponsor, token]);

  const acknowledge = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const message = buildAcknowledgmentMessage(stream, network);
      const { signedMessage } = await signMessage(message);
      const saved = await submitAcknowledgment(recipient, {
        sponsor,
        token,
        action: "acknowledge",
        signedMessage,
      });
      setRecord(saved);
      setPhase("resolved");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Acknowledgment failed");
      setPhase("pending");
    } finally {
      setBusy(false);
    }
  }, [recipient, sponsor, token, network, signMessage, stream]);

  const skip = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await submitAcknowledgment(recipient, {
        sponsor,
        token,
        action: "skip",
      });
      setRecord(saved);
      setPhase("resolved");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not dismiss the banner");
      setPhase("pending");
    } finally {
      setBusy(false);
    }
  }, [recipient, sponsor, token]);

  return { phase, record, error, busy, acknowledge, skip };
}
