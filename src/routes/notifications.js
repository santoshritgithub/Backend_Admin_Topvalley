import { Router } from "express";
import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();
router.use(requireAdmin);

router.get("/", async (_req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find().sort({ date: -1, createdAt: -1 }).limit(100),
    Notification.countDocuments({ read: false }),
  ]);
  res.json({ unread, items });
});

router.patch("/read-all", async (_req, res) => {
  await Notification.updateMany({ read: false }, { read: true });
  res.json({ ok: true });
});

router.patch("/:id/read", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Not found" });
  await Notification.findByIdAndUpdate(req.params.id, { read: true });
  res.json({ ok: true });
});

export default router;
