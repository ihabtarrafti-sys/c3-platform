/**
 * workItemGenerators.ts — re-export barrel
 *
 * Sprint 14 S14-3: the implementation has been split into
 * utils/workItemGenerators/ (directory). This file preserves the existing
 * import path @c3/utils/workItemGenerators for all consumers while the
 * directory holds the actual implementation.
 *
 * Consumers importing generateWorkItems do not need to change.
 */
export { generateWorkItems } from './workItemGenerators/index';
