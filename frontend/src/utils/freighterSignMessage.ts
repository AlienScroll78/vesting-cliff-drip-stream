import { SignMessageResult } from "@/utils/streamAcknowledgments";

function toBase64(value: ArrayBufferView | string): string {
  if (typeof value === "string") return value;
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function signWithFreighter(
  message: string,
): Promise<SignMessageResult> {
  const { signMessage } = await import("@stellar/freighter-api");
  const result = await signMessage(message);

  if (result.error) {
    throw new Error(result.error.message || "Freighter declined to sign the message");
  }
  if (!result.signedMessage) {
    throw new Error("Freighter returned an empty signature");
  }

  return {
    signedMessage: toBase64(result.signedMessage),
    signerAddress: result.signerAddress,
  };
}
