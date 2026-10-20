/**
 * backend/src/indexer/index.ts
 *
 * Public API barrel for the stream event indexer module.
 * Import from this file rather than from internal submodules.
 */

export { StreamIndexer, startStreamIndexer, getStreamIndexer } from './StreamIndexer.js';
export { decodeEvent, decodeSymbol, decodeAddress, decodeI128 } from './decoder.js';
export { computeBackoff, buildEventsUrl, HorizonHttpError } from './horizonClient.js';
export {
  indexerRegistry,
  eventsIndexedTotal,
  indexerLagSeconds,
  horizonErrorsTotal,
  indexerPollDurationSeconds,
  getMetricsOutput,
  getContentType,
} from './metrics.js';
export type {
  StreamEventType,
  DecodedStreamEvent,
  IndexerConfig,
  FetchPageResult,
  HorizonEventRecord,
} from './types.js';
