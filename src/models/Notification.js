import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["missed_attendance", "payment_overdue"], default: "missed_attendance" },
    member: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true },
    memberName: { type: String, required: true },
    date: { type: String, required: true }, // missed attendance: the unmarked day; payment_overdue: the promised pay-by date (YYYY-MM-DD)
    message: { type: String, required: true },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// One notification per member per day, so re-running the check never duplicates.
notificationSchema.index({ member: 1, date: 1, type: 1 }, { unique: true });

export default mongoose.model("Notification", notificationSchema);
