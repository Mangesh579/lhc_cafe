import rateLimit from "express-rate-limit";

// Strict limiter for auth routes: 5 attempts per 15 minutes per IP.
// Stops brute-force password guessing without affecting normal staff
// logins (nobody legitimately fails login 5 times in 15 minutes).
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  skipSuccessfulRequests: true, // only counts failed/attempted requests, not successful logins
});

// Looser general limiter for all other API routes — generous enough that
// normal staff dashboard usage and customer QR ordering never hit it, but
// stops automated scraping or abuse.
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

// Slightly tighter limiter specifically for the public QR-ordering
// endpoints, since these are unauthenticated and the most exposed to
// abuse from outside the cafe.
export const publicOrderRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});