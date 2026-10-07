// Date helpers on YYYY-MM-DD strings so results never shift with server timezone.
const toUtc = (s) => new Date(`${s}T00:00:00Z`);
export const fmt = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => fmt(new Date(toUtc(s).getTime() + n * 86400000));

// "Today" in the business's timezone (not the server's), so marking works early in the morning too.
const TZ = process.env.TIMEZONE || "Asia/Kathmandu";
export const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
