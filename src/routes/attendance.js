import { Router } from "express";
import Member from "../models/Member.js";
import Attendance from "../models/Attendance.js";
import { requireAdmin } from "../middleware/auth.js";
import { addDays, todayStr } from "../dates.js";
import { rideOut } from "../rides.js";

const router = Router();
router.use(requireAdmin);

// Everyone whose plan covers the given date, with their mark for that day.
router.get("/day", async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : todayStr();
  const members = await Member.find({ startDate: { $lte: date } }).sort({ name: 1 });
  const active = members.filter((m) => addDays(m.startDate, m.planDays - 1) >= date);
  const marks = await Attendance.find({ date, member: { $in: active.map((m) => m._id) } });
  const byId = Object.fromEntries(marks.map((a) => [String(a.member), a]));
  res.json({
    date,
    members: active.map((m) => ({
      _id: m._id,
      name: m.name,
      phone: m.phone,
      vehicle: m.vehicle,
      planDays: m.planDays,
      status: byId[String(m._id)]?.status || null,
      sessions: (byId[String(m._id)]?.sessions || []).map(rideOut),
    })),
  });
});

export default router;
