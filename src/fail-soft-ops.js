// @ts-check

/**
 * Preserve fail-soft behavior while making the primary operation failure observable.
 *
 * The observability callback is intentionally isolated: its own failure must not
 * change the caller's historical fallback behavior, but it is surfaced locally
 * rather than swallowed.
 *
 * @template T
 * @param {() => Promise<T>} operation
 * @param {{ fallback: T, onFailure: (error: unknown) => Promise<unknown> }} options
 * @returns {Promise<T>}
 */
export async function failSoftWithOpsEvent(operation, { fallback, onFailure }) {
  try {
    return await operation();
  } catch (error) {
    try {
      await onFailure(error);
    } catch {
      console.error('Fail-soft operational event could not be persisted.');
    }
    return fallback;
  }
}
