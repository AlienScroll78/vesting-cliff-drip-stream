import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StreamAcknowledgmentBanner } from "@/components/StreamAcknowledgmentBanner";
import { VestingStream } from "@/types";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mswServer";
import { BASE_URL } from "@/test/handlers";

const RECIPIENT = "GABC1RECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const SPONSOR = "GSPON1SPONSORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const stream: VestingStream = {
  id: "1",
  recipient: RECIPIENT,
  sponsor: SPONSOR,
  token: "USDC",
  rate: 10,
  claimableAmount: 1500,
  status: "active",
  startLedger: 51_000_000,
  cliffLedger: 51_100_000,
  endLedger: 52_000_000,
  totalDeposit: 10_000_000,
};

const signedMessage = "c2lnbmF0dXJl";

function renderBanner(overrides: Partial<Parameters<typeof StreamAcknowledgmentBanner>[0]> = {}) {
  const signMessage = vi.fn().mockResolvedValue({ signedMessage, signerAddress: RECIPIENT });
  const utils = render(
    <StreamAcknowledgmentBanner stream={stream} signMessage={signMessage} {...overrides} />,
  );
  return { ...utils, signMessage };
}

describe("StreamAcknowledgmentBanner", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("shows the pending banner on first visit", async () => {
    renderBanner();
    expect(await screen.findByTestId("stream-acknowledgment-banner")).toBeInTheDocument();
    expect(screen.getByText("Stream pending acknowledgment")).toBeInTheDocument();
  });

  it("summarises who created the stream, the amount and the cliff", async () => {
    renderBanner();
    const banner = await screen.findByTestId("stream-acknowledgment-banner");
    expect(banner).toHaveTextContent(SPONSOR);
    expect(banner).toHaveTextContent("10,000,000 USDC");
    expect(banner).toHaveTextContent("cliff on ledger 51100000");
  });

  it("states that acknowledging costs no XLM and is skippable", async () => {
    renderBanner();
    const banner = await screen.findByTestId("stream-acknowledgment-banner");
    expect(banner).toHaveTextContent(/costs no XLM/i);
    expect(banner).toHaveTextContent(/skip this/i);
  });

  it("does not sign anything when skipped", async () => {
    const { signMessage } = renderBanner();
    await screen.findByTestId("stream-acknowledgment-banner");
    await userEvent.click(screen.getByTestId("skip-acknowledgment-btn"));

    await waitFor(() =>
      expect(screen.queryByTestId("stream-acknowledgment-banner")).not.toBeInTheDocument(),
    );
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("signs a message containing the stream terms and stores it", async () => {
    const { signMessage } = renderBanner();
    await screen.findByTestId("stream-acknowledgment-banner");
    await userEvent.click(screen.getByTestId("acknowledge-stream-btn"));

    await waitFor(() => expect(signMessage).toHaveBeenCalledOnce());
    const message = signMessage.mock.calls[0]?.[0] as string;
    expect(message).toContain(`sponsor: ${SPONSOR}`);
    expect(message).toContain(`recipient: ${RECIPIENT}`);
    expect(message).toContain("token: USDC");
    expect(message).toContain("total deposit: 10000000 USDC");
    expect(message).toContain("cliff ledger: 51100000");
    expect(message).toContain("network: testnet");

    await waitFor(() =>
      expect(screen.queryByTestId("stream-acknowledgment-banner")).not.toBeInTheDocument(),
    );
  });

  it("sends the signature to the backend with the acknowledge action", async () => {
    const received: {
      value: { action?: string; signedMessage?: string } | null;
    } = { value: null };
    server.use(
      http.post(`${BASE_URL}/streams/:recipient/acknowledgments`, async ({ request }) => {
        received.value = (await request.json()) as {
          action?: string;
          signedMessage?: string;
        };
        return HttpResponse.json(
          {
            recipient: RECIPIENT,
            sponsor: SPONSOR,
            token: "USDC",
            acknowledged_at: "2026-01-02T03:04:05.000Z",
            skipped_at: null,
            signed_message: signedMessage,
            pending: false,
          },
          { status: 201 },
        );
      }),
    );

    renderBanner();
    await screen.findByTestId("stream-acknowledgment-banner");
    await userEvent.click(screen.getByTestId("acknowledge-stream-btn"));

    await waitFor(() => expect(received.value).not.toBeNull());
    expect(received.value?.action).toBe("acknowledge");
    expect(received.value?.signedMessage).toBe(signedMessage);
  });

  it("stays visible and reports the error when the wallet rejects signing", async () => {
    const signMessage = vi.fn().mockRejectedValue(new Error("User rejected the request"));
    render(
      <StreamAcknowledgmentBanner stream={stream} signMessage={signMessage} />,
    );
    await screen.findByTestId("stream-acknowledgment-banner");
    await userEvent.click(screen.getByTestId("acknowledge-stream-btn"));

    expect(await screen.findByTestId("acknowledgment-error")).toHaveTextContent(
      "User rejected the request",
    );
    expect(screen.getByTestId("stream-acknowledgment-banner")).toBeInTheDocument();
  });

  it("stays visible when the backend cannot be reached", async () => {
    server.use(
      http.get(`${BASE_URL}/streams/:recipient/acknowledgments`, () => HttpResponse.error()),
    );
    renderBanner();
    expect(await screen.findByTestId("stream-acknowledgment-banner")).toBeInTheDocument();
    expect(await screen.findByTestId("acknowledgment-error")).toBeInTheDocument();
  });

  it("stays visible when saving fails", async () => {
    server.use(
      http.post(`${BASE_URL}/streams/:recipient/acknowledgments`, () =>
        HttpResponse.json({ error: "nope" }, { status: 500 }),
      ),
    );
    renderBanner();
    await screen.findByTestId("stream-acknowledgment-banner");
    await userEvent.click(screen.getByTestId("acknowledge-stream-btn"));

    expect(await screen.findByTestId("acknowledgment-error")).toHaveTextContent("500");
  });

  it("hides the banner when an acknowledgment already exists", async () => {
    server.use(
      http.get(`${BASE_URL}/streams/:recipient/acknowledgments`, ({ params }) =>
        HttpResponse.json({
          recipient: (params as { recipient: string }).recipient,
          items: [
            {
              recipient: RECIPIENT,
              sponsor: SPONSOR,
              token: "USDC",
              acknowledged_at: "2026-01-02T03:04:05.000Z",
              skipped_at: null,
              signed_message: "abc",
              pending: false,
            },
          ],
        }),
      ),
    );

    renderBanner();
    await waitFor(() =>
      expect(screen.queryByTestId("stream-acknowledgment-banner")).not.toBeInTheDocument(),
    );
  });

  it("hides the banner when the acknowledgment was already skipped", async () => {
    server.use(
      http.get(`${BASE_URL}/streams/:recipient/acknowledgments`, ({ params }) =>
        HttpResponse.json({
          recipient: (params as { recipient: string }).recipient,
          items: [
            {
              recipient: RECIPIENT,
              sponsor: SPONSOR,
              token: "USDC",
              acknowledged_at: null,
              skipped_at: "2026-01-02T03:04:05.000Z",
              signed_message: null,
              pending: false,
            },
          ],
        }),
      ),
    );

    renderBanner();
    await waitFor(() =>
      expect(screen.queryByTestId("stream-acknowledgment-banner")).not.toBeInTheDocument(),
    );
  });

  it("renders a reduced summary for a stream without a total deposit or cliff", async () => {
    const { totalDeposit: _deposit, cliffLedger: _cliff, ...minimal } = stream;
    render(
      <StreamAcknowledgmentBanner
        stream={minimal as VestingStream}
        signMessage={vi.fn().mockResolvedValue({ signedMessage, signerAddress: RECIPIENT })}
      />,
    );
    const banner = await screen.findByTestId("stream-acknowledgment-banner");
    expect(banner).toHaveTextContent("an amount of USDC");
    expect(banner).not.toHaveTextContent("cliff on ledger");
    expect(banner).not.toHaveTextContent("10,000,000");
  });
});
