import { Router } from "express";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import Review from "../models/Review.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many reviews submitted. Please try again later." },
});

// ---- Public ----
router.get("/approved", async (_req, res) => {
  const reviews = await Review.find({ status: "approved" })
    .sort({ createdAt: -1 })
    .limit(30)
    .select("name text rating createdAt");
  res.json(reviews);
});

router.post("/", submitLimiter, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const text = String(req.body?.text || "").trim();
  const rating = Math.min(5, Math.max(1, Number(req.body?.rating) || 5));
  if (!name || !text) return res.status(400).json({ message: "Name and review are required" });
  if (name.length > 60 || text.length > 600) return res.status(400).json({ message: "Name or review is too long" });
  await Review.create({ name, text, rating }); // status always starts as pending
  res.status(201).json({ message: "Thank you! Your review will appear once approved." });
});

// ---- Admin ----
router.get("/", requireAdmin, async (req, res) => {
  const filter = ["pending", "approved", "rejected"].includes(req.query.status) ? { status: req.query.status } : {};
  res.json(await Review.find(filter).sort({ createdAt: -1 }));
});

router.patch("/:id", requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Review not found" });
  const { status } = req.body || {};
  if (!["pending", "approved", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status" });
  const review = await Review.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!review) return res.status(404).json({ message: "Review not found" });
  res.json(review);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Review not found" });
  await Review.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
