import type { Request, Response } from 'express';
import { validateAddress } from '../validation.js';

export interface VestingScheduleResponse {
  recipient: string;
  token: string;
  rate_per_ledger: number;
  start_ledger: number;
  cliff_ledger: number;
  end_ledger: number;
  last_claimed_ledger: number;
  claimable_amount: number;
  is_cliff_passed: boolean;
}

interface ScheduleRecord {
  recipient: string;
  token: string;
  rate_per_ledger: number;
  start_ledger: number;
  cliff_ledger: number;
  end_ledger: number;
  last_claimed_ledger: number;
}

const seedRecipient = 'G' + 'A'.repeat(55);
const scheduleStore = new Map<string, ScheduleRecord>([[
  seedRecipient,
  {
    recipient: seedRecipient,
    token: 'C' + 'A'.repeat(55),
    rate_per_ledger: 10,
    start_ledger: 1000,
    cliff_ledger: 1100,
    end_ledger: 2000,
    last_claimed_ledger: 1000,
  },
]]);
const cache = new Map<string, { expiresAt: number; payload: VestingScheduleResponse }>();

function buildResponse(recipient: string, schedule: ScheduleRecord, currentLedger: number): VestingScheduleResponse {
  const isCliffPassed = currentLedger >= schedule.cliff_ledger;
  // Mirror Soroban claimable_amount: returns 0 when cliff not yet reached
  const claimableLedgers = isCliffPassed
    ? Math.max(0, Math.min(currentLedger, schedule.end_ledger) - schedule.last_claimed_ledger)
    : 0;
  const claimableAmount = claimableLedgers * schedule.rate_per_ledger;

  return {
    recipient,
    token: schedule.token,
    rate_per_ledger: schedule.rate_per_ledger,
    start_ledger: schedule.start_ledger,
    cliff_ledger: schedule.cliff_ledger,
    end_ledger: schedule.end_ledger,
    last_claimed_ledger: schedule.last_claimed_ledger,
    claimable_amount: claimableAmount,
    is_cliff_passed: isCliffPassed,
  };
}

export function createScheduleController() {
  return (req: Request, res: Response) => {
    try {
      const recipient = validateAddress(req.params.recipient);
      const cacheKey = recipient;
      const now = Date.now();
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return res.status(200).json(cached.payload);
      }

      const schedule = scheduleStore.get(recipient);
      if (!schedule) {
        return res.status(404).json({ error: 'Schedule not found' });
      }

      const currentLedger = Number(process.env.CURRENT_LEDGER ?? 1100);
      const payload = buildResponse(recipient, schedule, currentLedger);
      cache.set(cacheKey, { expiresAt: now + 3000, payload });
      return res.status(200).json(payload);
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid Stellar address') {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}
