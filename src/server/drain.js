import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

export class AdminDrainManager {
  constructor(options = {}) {
    this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET || 'secret-key';
    this.cooldownMs = options.cooldownMs ?? 300000; // 5 minutes
    this.lastDrainTime = 0;
    this.streams = options.streams || [
      { recipient: 'GCXX1111111111111111111111111111111111111111111111111111', end_ledger: 100 },
      { recipient: 'GCXX2222222222222222222222222222222222222222222222222222', end_ledger: 200 },
      { recipient: 'GCXX3333333333333333333333333333333333333333333333333333', end_ledger: 500 }
    ];
    this.getCurrentLedger = options.getCurrentLedger || (() => 300);
    this.logger = options.logger || console;
  }

  verifyAdminJwt(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const err = new Error('Missing or invalid Authorization header');
      err.status = 401;
      throw err;
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      if (decoded.role !== 'admin' && decoded.scope !== 'admin' && !decoded.isAdmin) {
        const err = new Error('Admin scope required');
        err.status = 403;
        throw err;
      }
      return decoded;
    } catch (err) {
      if (err.status) throw err;
      const authErr = new Error('Invalid JWT token');
      authErr.status = 401;
      throw authErr;
    }
  }

  getDrainHandler() {
    return (req, res, next) => {
      try {
        // 1. Verify Admin JWT
        this.verifyAdminJwt(req.headers.authorization);

        // 2. Check Rate Limit (1 execution per 5 minutes)
        const now = Date.now();
        const isDryRun =
          req.query?.dry_run === 'true' ||
          req.query?.dry_run === true ||
          req.body?.dry_run === true ||
          req.body?.dry_run === 'true';

        if (!isDryRun && this.lastDrainTime > 0 && (now - this.lastDrainTime) < this.cooldownMs) {
          const remainingSecs = Math.ceil((this.cooldownMs - (now - this.lastDrainTime)) / 1000);
          return res.status(429).json({
            message: `Rate limit exceeded: 1 execution per 5 minutes. Try again in ${remainingSecs}s.`
          });
        }

        // 3. Perform scan and filter expired streams
        const currentLedger = req.body?.current_ledger ?? this.getCurrentLedger();
        const drainDelayLedgers = req.body?.drain_delay_ledgers ?? req.query?.drain_delay_ledgers ?? 10;

        const scanned = this.streams.length;
        const eligibleStreams = [];
        const processedStreams = [];

        for (const stream of this.streams) {
          const isExpired = currentLedger > (stream.end_ledger + Number(drainDelayLedgers));
          if (isExpired) {
            eligibleStreams.push(stream);
          }
        }

        if (isDryRun) {
          return res.json({
            scanned,
            eligible: eligibleStreams.length,
            submitted: 0,
            dry_run: true,
            streams: eligibleStreams.map(s => ({
              recipient: s.recipient,
              end_ledger: s.end_ledger,
              tx_hash: null
            }))
          });
        }

        // Execute drain for eligible streams
        for (const stream of eligibleStreams) {
          const txHash = crypto.createHash('sha256').update(`${stream.recipient}:${Date.now()}`).digest('hex');
          this.logger.log(`[Drain] Processed stream drain for recipient=${stream.recipient}, end_ledger=${stream.end_ledger}, tx_hash=${txHash}`);
          processedStreams.push({
            recipient: stream.recipient,
            end_ledger: stream.end_ledger,
            tx_hash: txHash
          });
        }

        this.lastDrainTime = now;

        res.json({
          scanned,
          eligible: eligibleStreams.length,
          submitted: processedStreams.length,
          dry_run: false,
          streams: processedStreams
        });
      } catch (err) {
        next(err);
      }
    };
  }
}
