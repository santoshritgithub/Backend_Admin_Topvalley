import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Admin from "./models/Admin.js";
import authRoutes from "./routes/auth.js";
import memberRoutes from "./routes/members.js";
import attendanceRoutes from "./routes/attendance.js";
import pricingRoutes from "./routes/pricing.js";
import notificationRoutes from "./routes/notifications.js";
import { startAttendanceJob } from "./jobs/attendanceCheck.js";
import reviewRoutes from "./routes/reviews.js";

const { MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, PORT = 5000 } = process.env;
if (!MONGODB_URI || !JWT_SECRET) {
  console.error("MONGODB_URI and JWT_SECRET must be set in .env");
  process.exit(1);
}

const origins = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const app = express();
app.use(helmet());
// Listed origins always work; outside production, any local/LAN dev origin works too.
const isLocalDev = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(o);
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin) || (process.env.NODE_ENV !== "production" && isLocalDev(origin))),
  }),
);
app.use(express.json({ limit: "20kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reviews", reviewRoutes);

// Express 5 forwards async errors here.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Something went wrong" });
});

await mongoose.connect(MONGODB_URI);
console.log("MongoDB connected");

// Create the admin account on first run from .env.
if (ADMIN_EMAIL && ADMIN_PASSWORD && !(await Admin.findOne({ email: ADMIN_EMAIL.toLowerCase() }))) {
  await Admin.create({ email: ADMIN_EMAIL, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10) });
  console.log(`Admin created: ${ADMIN_EMAIL}`);
}

startAttendanceJob();
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
