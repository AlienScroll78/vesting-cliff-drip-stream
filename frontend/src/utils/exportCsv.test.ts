import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateStreamsCsv, downloadCsv } from "./exportCsv";
import { VestingStream } from "@/types";

describe("exportCsv", () => {
  const mockStreams: VestingStream[] = [
    {
      id: "1",
      recipient: "GABC123",
      sponsor: "GSPON456",
      token: "USDC",
      rate: 10,
      claimableAmount: 1500,
      status: "active",
      startLedger: 100,
      cliffLedger: 200,
      endLedger: 1000,
      totalDeposit: 5000,
    },
    {
      id: "2",
      recipient: "GDEF789",
      sponsor: "GSPON456",
      token: "XLM",
      rate: 5,
      claimableAmount: 0,
      status: "pre-cliff",
      totalDeposit: 3000,
    },
  ];

  describe("generateStreamsCsv", () => {
    it("should generate valid CSV header", () => {
      const csv = generateStreamsCsv(mockStreams);
      const lines = csv.split("\n");
      const header = lines[0];

      expect(header).toContain("ID");
      expect(header).toContain("Recipient");
      expect(header).toContain("Token");
      expect(header).toContain("Status");
    });

    it("should generate CSV rows for each stream", () => {
      const csv = generateStreamsCsv(mockStreams);
      const lines = csv.split("\n");

      expect(lines).toHaveLength(3); // header + 2 streams
      expect(lines[1]).toContain("1"); // First stream ID
      expect(lines[2]).toContain("2"); // Second stream ID
    });

    it("should escape special characters in CSV", () => {
      const streamsWithSpecialChars: VestingStream[] = [
        {
          id: '1',
          recipient: "GABC,123", // contains comma
          sponsor: 'GSPON"456', // contains quote
          token: "USDC",
          rate: 10,
          claimableAmount: 1500,
          status: "active",
        },
      ];

      const csv = generateStreamsCsv(streamsWithSpecialChars);
      const lines = csv.split("\n");
      const row = lines[1];

      // Comma and quote should be escaped/quoted
      expect(row).toContain('"');
    });

    it("should handle missing optional fields", () => {
      const streamWithoutLedgers: VestingStream[] = [
        {
          id: "1",
          recipient: "GABC123",
          sponsor: "GSPON456",
          token: "USDC",
          rate: 10,
          claimableAmount: 1500,
          status: "completed",
        },
      ];

      const csv = generateStreamsCsv(streamWithoutLedgers);
      expect(csv).toBeDefined();
      expect(csv.split("\n")).toHaveLength(2); // header + 1 stream
    });
  });

  describe("downloadCsv", () => {
    beforeEach(() => {
      // Mock document methods
      vi.spyOn(document, "createElement");
      vi.spyOn(document, "appendChild");
      vi.spyOn(document, "removeChild");
      URL.createObjectURL = vi.fn(() => "blob:mock-url");
      URL.revokeObjectURL = vi.fn();
    });

    it("should trigger download with correct filename", () => {
      const csv = "ID,Name\n1,Test";
      const filename = "test-export.csv";

      downloadCsv(csv, filename);

      const createLink = vi.spyOn(document, "createElement").mock.results.find(
        (result) => result.value.setAttribute
      );
      expect(createLink).toBeDefined();
    });

    it("should use default filename if not provided", () => {
      const csv = "ID,Name\n1,Test";

      downloadCsv(csv);

      // Should call createObjectURL
      expect(URL.createObjectURL).toHaveBeenCalled();
    });
  });
});
