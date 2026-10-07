import { Router } from "express";
import mongoose from "mongoose";
import Member, { PLAN_DAYS } from "../models/Member.js";
import Attendance from "../models/Attendance.js";
import Notification from "../models/Notification.js";
import { requireAdmin } from "../middleware/auth.js";
import { addDays, todayStr } from "../dates.js";

const router = Router();
router.use(requireAdmin);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const endDate = (m) => addDays(m.startDate, m.planDays - 1);
const dueOf = (m) => Math.max(0, (m.amount || 0) - (m.amountPaid || 0));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const withPlan = (m) => ({ ...m.toJSON(), endDate: endDate(m), due: dueOf(m) });

function pick(body) {
  const out = {};
  for (const k of ["name", "phone", "address", "vehicle", "planDays", "startDate", "notes", "amount", "amountPaid"]) {
    if (body[k] !== undefined) out[k] = ["planDays", "amount", "amountPaid"].includes(k) ? Number(body[k]) || 0 : body[k];
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
  const counts = await Attendance.aggregate([
    { $match: { member: { $in: members.map((m) => m._id) }, status: "present" } },
    { $group: { _id: "$member", n: { $sum: 1 } } },
  ]);
  const byId = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  const today = todayStr();
  res.json(
    members.map((m) => {
      const end = endDate(m);
      const status = today < m.startDate ? "upcoming" : today > end ? "completed" : "active";
      return { ...m.toJSON(), endDate: end, due: dueOf(m), presentCount: byId[String(m._id)] || 0, status };
    }),
  );
});

router.post("/", async (req, res) => {
  const data = pick(req.body);
  if (!PLAN_DAYS.includes(data.planDays)) return res.status(400).json({ message: "Plan must be 7, 15 or 30 days" });
  if (!DATE_RE.test(data.startDate || "")) return res.status(400).json({ message: "Start date is required" });
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
  const attendance = await Attendance.find({ member: member._id }).sort({ date: 1 });
  res.json({
    ...withPlan(member),
    attendance: attendance.map((a) => ({ date: a.date, status: a.status })),
  });
});

router.put("/:id", validId, async (req, res) => {
  const data = pick(req.body);
  if (data.planDays !== undefined && !PLAN_DAYS.includes(data.planDays)) {
    return res.status(400).json({ message: "Plan must be 7, 15 or 30 days" });
  }
  try {
    const member = await Member.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!member) return res.status(404).json({ message: "Member not found" });
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
    await Attendance.findOneAndUpdate({ member: member._id, date }, { status }, { upsert: true, new: true });
    // Marked now, so the "missed attendance" alert for that day is resolved.
    await Notification.deleteOne({ member: member._id, date, type: "missed_attendance" });
  }
  res.json({ ok: true });
});

export default router;
