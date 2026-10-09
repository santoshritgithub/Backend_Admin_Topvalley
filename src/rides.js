export const RIDE_MS = 30 * 60 * 1000;

// A plan box is used up when its 30-minute ride has finished, or when it was marked absent.
export const slotUsed = (s, now = Date.now()) => s.status === "absent" || Boolean(s.startedAt && s.pausedLeft == null && rideEnd(s, now) <= now);
export const usedOf = (m) => (m.slots || []).filter((s) => slotUsed(s)).length;

// Shape a stored ride (attendance session or plan box) for the admin app.
// endsAt moves when a ride is paused/resumed; pausedLeft (ms) is set only while paused.
export const rideOut = (s) => ({
  startedAt: s.startedAt,
  endsAt: s.endsAt || new Date(new Date(s.startedAt).getTime() + RIDE_MS),
  pausedLeft: s.pausedLeft ?? null,
});

// When a ride finishes (a paused ride finishes `pausedLeft` after it resumes).
export const rideEnd = (s, now = Date.now()) =>
  s.pausedLeft != null ? now + s.pausedLeft : (s.endsAt ? new Date(s.endsAt).getTime() : new Date(s.startedAt).getTime() + RIDE_MS);
