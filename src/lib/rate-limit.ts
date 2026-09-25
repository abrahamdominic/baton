/**
 * In-memory fixed-window rate limiter for sensitive endpoints.
 */
class InMemoryRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  /** Returns true when the request is allowed. */
  check(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count < limit) {
      bucket.count += 1;
      return true;
    }
    return false;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

export const rateLimiter = new InMemoryRateLimiter();