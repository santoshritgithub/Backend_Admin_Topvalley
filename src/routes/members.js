import { Router } from "express";
import mongoose from "mongoose";
import Member, { PLAN_DAYS } from "../models/Member.js";
import Attendance from "../models/Attendance.js";
import Notification from "../models/Notification.js";
import { requireAdmin } from "../middleware/auth.js";
import { addDays, todayStr } from "../dates.js";
import { RIDE_MS, rideEnd, rideOut, slotUsed, usedOf } from "../rides.js";
import { creditUsedUp, raiseOverdue } from "../payments.js";

const router = Router();
router.use(requireAdmin);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const endDate = (m) => addDays(m.startDate, m.planDays - 1);
const dueOf = (m) => Math.max(0, (m.amount || 0) - (m.amountPaid || 0));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Rides never overlap: a new one starts when the latest running/queued ride ends.
function nextStart(m) {
  const ends = (m.slots || []).filter((s) => s.status === "present" && s.startedAt).map((s) => rideEnd(s));
  return new Date(Math.max(Date.now(), ...ends));
}

// Mirror a box mark onto today's roll call so Attendance, Dashboard and Members stay in step.
async function mirrorToday(member, status, startedAt) {
  const date = todayStr();
  if (date < member.startDate || date > endDate(member)) return;
  if (status === "present") {
    await Attendance.findOneAndUpdate({ member: member._id, date }, { status, $push: { sessions: { startedAt, endsAt: new Date(startedAt.getTime() + RIDE_MS) } } }, { upsert: true });
  } else {
    const ex = await Attendance.findOne({ member: member._id, date });
    if (ex?.status === "present") return;
    await Attendance.findOneAndUpdate({ member: member._id, date }, { status, sessions: [] }, { upsert: true });
  }
  await Notification.deleteOne({ member: member._id, date, type: "missed_attendance" });
}

// Members marked before boxes existed: build their boxes from the old per-date marks (once).
async function migrateSlots(members) {
  const todo = members.filter((m) => !m.slots?.length);
  if (!todo.length) return;
  const marks = await Attendance.find({ member: { $in: todo.map((m) => m._id) } }).sort({ date: 1 });
  for (const m of todo) {
    const slots = [];
    for (const a of marks.filter((x) => String(x.member) === String(m._id))) {
      if (a.status === "absent") slots.push({ i: slots.length, status: "absent" });
      else if (a.sessions?.length) a.sessions.forEach((s) => slots.push({ i: slots.length, status: "present", startedAt: s.startedAt }));
      else slots.push({ i: slots.length, status: "present", startedAt: new Date(`${a.date}T00:00:00Z`) });
    }
    if (!slots.length) continue;
    m.slots = slots.slice(0, m.planDays);
    await m.save();
  }
}

const withPlan = (m) => ({ ...m.toJSON(), endDate: endDate(m), due: dueOf(m) });

// Part payment needs the number of days the learner may train before paying the balance.
function checkGraceDays(data, current) {
  const amount = data.amount ?? current?.amount ?? 0;
  const paid = data.amountPaid ?? current?.amountPaid ?? 0;
  if (amount - paid <= 0) {
    data.graceDays = 0;
    return null;
  }
  const days = Math.floor(Number(data.graceDays ?? current?.graceDays ?? 0));
  const plan = data.planDays ?? current?.planDays ?? 7;
  if (!(days >= 1 && days <= plan)) return `Part payment: enter how many days (1-${plan}) are allowed before the rest is paid`;
  data.graceDays = days;
  return null;
}

function pick(body) {
  const out = {};
  for (const k of ["name", "phone", "address", "vehicle", "planDays", "startDate", "notes", "amount", "amountPaid", "graceDays"]) {
    if (body[k] !== undefined) out[k] = ["planDays", "amount", "amountPaid", "graceDays"].includes(k) ? Number(body[k]) || 0 : body[k];
  }
  return out;
}

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(404).json({ message: "Member not found" });

router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const filter = q
    ? { $or: [{ name: new RegExp(escapeRe(q), "i") }, { phone: new RegExp(escapeRe(q)) }] }
    : {};
  const members = await Member.find(filter).sort({ createdAt: -1 });
  await migrateSlots(members);
  const todayMarks = await Attendance.find({ date: todayStr(), status: "present", member: { $in: members.map((m) => m._id) } });
  const sessionsById = Object.fromEntries(todayMarks.map((a) => [String(a.member), (a.sessions || []).map(rideOut)]));
  const today = todayStr();
  res.json(
    members.map((m) => {
      const end = endDate(m);
      const status = today < m.startDate ? "upcoming" : today > end ? "completed" : "active";
      return { ...m.toJSON(), endDate: end, due: dueOf(m), presentCount: usedOf(m), todaySessions: sessionsById[String(m._id)] || [], status };
    }),
  );
});

router.post("/", async (req, res) => {
  const data = pick(req.body);
  if (!PLAN_DAYS.includes(data.planDays)) return res.status(400).json({ message: "Plan must be 7, 15 or 30 days" });
  if (!DATE_RE.test(data.startDate || "")) return res.status(400).json({ message: "Start date is required" });
  const dueErr = checkGraceDays(data);
  if (dueErr) return res.status(400).json({ message: dueErr });
  try {
    const member = await Member.create(data);
    res.status(201).json(withPlan(member));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.get("/:id", validId, async (req, res) => {
  const member = await Member.findById(req.params.id);
  if (!member) return res.status(404).json({ message: "Member not found" });
  await migrateSlots([member]);
  const attendance = await Attendance.find({ member: member._id }).sort({ date: 1 });
  res.json({
    ...withPlan(member),
    attendance: attendance.map((a) => ({ date: a.date, status: a.status, sessions: (a.sessions || []).map(rideOut) })),
  });
});

router.put("/:id", validId, async (req, res) => {
  const data = pick(req.body);
  if (data.planDays !== undefined && !PLAN_DAYS.includes(data.planDays)) {
    return res.status(400).json({ message: "Plan must be 7, 15 or 30 days" });
  }
  const current = await Member.findById(req.params.id);
  if (!current) return res.status(404).json({ message: "Member not found" });
  const dueErr = checkGraceDays(data, current);
  if (dueErr) return res.status(400).json({ message: dueErr });
  try {
    const member = await Member.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!member) return res.status(404).json({ message: "Member not found" });
    // Paid up or a new allowance: the old overdue alert no longer applies.
    await Notification.deleteMany({ member: member._id, type: "payment_overdue" });
    res.json(withPlan(member));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.delete("/:id", validId, async (req, res) => {
  const member = await Member.findByIdAndDelete(req.params.id);
  if (!member) return res.status(404).json({ message: "Member not found" });
  await Attendance.deleteMany({ member: member._id });
  await Notification.deleteMany({ member: member._id });
  res.json({ ok: true });
});

// Mark (or clear) attendance for one member on one date.
router.put("/:id/attendance", validId, async (req, res) => {
  const { date, status } = req.body || {};
  if (!DATE_RE.test(date || "")) return res.status(400).json({ message: "Valid date required" });
  if (!["present", "absent", "clear"].includes(status)) return res.status(400).json({ message: "Invalid status" });
  const member = await Member.findById(req.params.id);
  if (!member) return res.status(404).json({ message: "Member not found" });
  if (date > todayStr()) return res.status(400).json({ message: "Cannot mark attendance for a future date" });
  if (date < member.startDate || date > endDate(member)) {
    return res.status(400).json({ message: "Date is outside this member's plan" });
  }
  if (status === "clear") await Attendance.deleteOne({ member: member._id, date });
  else {
    await migrateSlots([member]);
    if (creditUsedUp(member)) {
      await raiseOverdue(member);
      return res.status(400).json({ message: `Allowed ${member.graceDays} days are used. Collect the remaining payment before marking more days.` });
    }
    const existing = await Attendance.findOne({ member: member._id, date });
    let update = { status, sessions: [] };
    let startedAt;
    if (status === "present") {
      startedAt = nextStart(member);
      update = { status, $push: { sessions: { startedAt, endsAt: new Date(startedAt.getTime() + RIDE_MS) } } };
    }
    await Attendance.findOneAndUpdate({ member: member._id, date }, update, { upsert: true, new: true });
    // Fill the next empty plan box (an absent day is only counted once).
    if (status === "present" || existing?.status !== "absent") {
      const taken = new Set((member.slots || []).map((s) => s.i));
      let i = 0;
      while (taken.has(i)) i++;
      if (i < member.planDays) {
        member.slots.push({ i, status, startedAt, endsAt: startedAt && new Date(startedAt.getTime() + RIDE_MS) });
        await member.save();
      }
    }
    // Marked now, so the "missed attendance" alert for that day is resolved.
    await Notification.deleteOne({ member: member._id, date, type: "missed_attendance" });
  }
  res.json({ ok: true });
});

// Mark one plan box (Day 1..N), independent of the calendar date.
router.put("/:id/slots/:i", validId, async (req, res) => {
  const i = Number(req.params.i);
  const { status } = req.body || {};
  if (!["present", "absent", "clear"].includes(status)) return res.status(400).json({ message: "Invalid status" });
  const member = await Member.findById(req.params.id);
  if (!member) return res.status(404).json({ message: "Member not found" });
  if (!Number.isInteger(i) || i < 0 || i >= member.planDays) return res.status(400).json({ message: "No such day in this plan" });
  await migrateSlots([member]);
  const old = member.slots.find((s) => s.i === i);
  // Once a ride has finished the day is locked.
  if (old && old.status === "present" && old.startedAt && slotUsed(old)) {
    return res.status(400).json({ message: "This day is finished and can no longer be changed." });
  }
  if (status !== "clear" && !old && creditUsedUp(member)) {
    await raiseOverdue(member);
    return res.status(400).json({ message: `Allowed ${member.graceDays} days are used. Collect the remaining payment before marking more days.` });
  }
  member.slots = member.slots.filter((s) => s.i !== i);
  if (old?.startedAt) {
    await Attendance.updateMany({ member: member._id }, { $pull: { sessions: { startedAt: old.startedAt } } });
  }
  let startedAt;
  if (status !== "clear") {
    startedAt = status === "present" ? nextStart(member) : undefined;
    member.slots.push({ i, status, startedAt, endsAt: startedAt && new Date(startedAt.getTime() + RIDE_MS) });
    await mirrorToday(member, status, startedAt);
  }
  await member.save();
  res.json({ ok: true });
});

// Pause or resume the 30-minute timer of one plan box.
// Also reachable as /:id/timer with the ride's startedAt (used by the Members and Attendance tables).
router.put(["/:id/slots/:i/timer", "/:id/timer"], validId, async (req, res) => {
  const i = req.params.i !== undefined ? Number(req.params.i) : null;
  const { action, startedAt: at } = req.body || {};
  if (!["pause", "resume"].includes(action)) return res.status(400).json({ message: "Invalid action" });
  const member = await Member.findById(req.params.id);
  if (!member) return res.status(404).json({ message: "Member not found" });
  const slot = member.slots.find((s) => s.status === "present" && (i !== null ? s.i === i : s.startedAt && Math.abs(s.startedAt.getTime() - new Date(at).getTime()) < 1000));
  if (!slot) return res.status(400).json({ message: "This day has no running timer" });
  const now = Date.now();
  const oldStart = slot.startedAt;
  const oldEnd = rideEnd(slot);
  if (action === "pause") {
    if (slot.pausedLeft != null) return res.json({ ok: true });
    if (slot.startedAt.getTime() > now || oldEnd <= now) return res.status(400).json({ message: "Timer is not running" });
    slot.pausedLeft = oldEnd - now;
    await Attendance.updateMany(
      { member: member._id, "sessions.startedAt": oldStart },
      { $set: { "sessions.$[s].pausedLeft": slot.pausedLeft } },
      { arrayFilters: [{ "s.startedAt": oldStart }] },
    );
  } else {
    if (slot.pausedLeft == null) return res.json({ ok: true });
    const end = new Date(now + slot.pausedLeft);
    const delta = end.getTime() - (slot.endsAt ? slot.endsAt.getTime() : oldStart.getTime() + RIDE_MS);
    slot.endsAt = end;
    slot.pausedLeft = undefined;
    await Attendance.updateMany(
      { member: member._id, "sessions.startedAt": oldStart },
      { $set: { "sessions.$[s].endsAt": end }, $unset: { "sessions.$[s].pausedLeft": "" } },
      { arrayFilters: [{ "s.startedAt": oldStart }] },
    );
    // Rides queued behind this one move back by the time it was paused, so none overlap.
    for (const q of member.slots) {
      if (q === slot || q.status !== "present" || !q.startedAt || q.pausedLeft != null || q.startedAt.getTime() < oldEnd - 1000) continue;
      const qStart = q.startedAt;
      q.startedAt = new Date(qStart.getTime() + delta);
      q.endsAt = new Date(rideEnd({ startedAt: qStart, endsAt: q.endsAt }) + delta);
      await Attendance.updateMany(
        { member: member._id, "sessions.startedAt": qStart },
        { $set: { "sessions.$[s].startedAt": q.startedAt, "sessions.$[s].endsAt": q.endsAt } },
        { arrayFilters: [{ "s.startedAt": qStart }] },
      );
    }
  }
  await member.save();
  res.json({ ok: true });
});

export default router;
