import cron from "node-cron";
import Member from "../models/Member.js";
import Attendance from "../models/Attendance.js";
import Notification from "../models/Notification.js";
import JobRun from "../models/JobRun.js";
import { addDays, todayStr } from "../dates.js";

const TZ = process.env.TIMEZONE || "Asia/Kathmandu";
const CHECK_HOUR = 17; // 5 PM

const hourNow = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date())) % 24;

// Claim today's run. Returns false if the check already ran today (any process, any restart).
async function claimToday(date) {
  try {
    const claimed = await JobRun.findOneAndUpdate(
      { key: "attendance-check", lastRunDate: { $ne: date } },
      { lastRunDate: date },
      { upsert: true, new: true },
    );
    return Boolean(claimed);
  } catch (e) {
    if (e.code === 11000) return false; // row exists and already holds today's date
    throw e;
  }
}

// Raise a notification for every learner whose plan covers today but has no attendance mark.
async function checkMissedAttendance() {
  const date = todayStr();
  if (!(await claimToday(date))) {
    console.log(`[attendance-check] ${date}: already ran today, skipping`);
    return;
  }
  const members = await Member.find({ startDate: { $lte: date } });
  const running = members.filter((m) => addDays(m.startDate, m.planDays - 1) >= date);
  const marked = new Set((await Attendance.find({ date }).select("member")).map((a) => String(a.member)));
  const missed = running.filter((m) => !marked.has(String(m._id)));

  let created = 0;
  for (const m of missed) {
    const res = await Notification.updateOne(
      { member: m._id, date, type: "missed_attendance" },
      { $setOnInsert: { memberName: m.name, message: `Attendance not marked for ${m.name} today`, read: false } },
      { upsert: true },
    );
    if (res.upsertedCount) created++;
  }
  console.log(`[attendance-check] ${date}: ${running.length} running, ${missed.length} unmarked, ${created} new notifications`);
}

export function startAttendanceJob() {
  cron.schedule(`0 ${CHECK_HOUR} * * *`, () => checkMissedAttendance().catch(console.error), { timezone: TZ });
  console.log(`Attendance check scheduled daily at ${CHECK_HOUR}:00 (${TZ})`);
  // If the server was down at 5 PM, catch up as soon as it starts.
  if (hourNow() >= CHECK_HOUR) checkMissedAttendance().catch(console.error);
}
