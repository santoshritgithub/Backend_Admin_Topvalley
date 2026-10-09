import mongoose from "mongoose";

export const PLAN_DAYS = [7, 15, 30];

const memberSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    address: { type: String, trim: true, maxlength: 200, default: "" },
    vehicle: { type: String, enum: ["scooter", "bike", "car"], required: true },
    planDays: { type: Number, enum: PLAN_DAYS, required: true },
    // Fee for the chosen plan and what has been paid so far.
    amount: { type: Number, min: 0, default: 0 },
    amountPaid: { type: Number, min: 0, default: 0 },
    // Part payment: days the learner may train before the balance must be paid (0 = no limit).
    graceDays: { type: Number, min: 0, default: 0 },
    // Stored as YYYY-MM-DD so there are no timezone surprises.
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    // Date-independent plan boxes: slot i is "Day i+1" of the plan. A present slot runs a 30-minute timer.
    slots: [
      {
        _id: false,
        i: { type: Number, required: true, min: 0 },
        status: { type: String, enum: ["present", "absent"], required: true },
        startedAt: { type: Date },
        endsAt: { type: Date },
        pausedLeft: { type: Number }, // ms left on the timer while paused
      },
    ],
    notes: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("Member", memberSchema);
