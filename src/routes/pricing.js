import { Router } from "express";
import Pricing from "../models/Pricing.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();
router.use(requireAdmin);

const VEHICLES = ["scooter", "bike", "car"];
const PLANS = ["d7", "d15", "d30"];

const shape = (doc) =>
  Object.fromEntries(VEHICLES.map((v) => [v, Object.fromEntries(PLANS.map((p) => [p, doc?.[v]?.[p] || 0]))]));

router.get("/", async (_req, res) => {
  res.json(shape(await Pricing.findOne({ key: "pricing" })));
});

router.put("/", async (req, res) => {
  const update = {};
  for (const v of VEHICLES) {
    for (const p of PLANS) {
      const n = Number(req.body?.[v]?.[p]);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: `Invalid amount for ${v} ${p.slice(1)} days` });
      update[`${v}.${p}`] = n;
    }
  }
  const doc = await Pricing.findOneAndUpdate({ key: "pricing" }, { $set: update }, { upsert: true, new: true });
  res.json(shape(doc));
});

export default router;
