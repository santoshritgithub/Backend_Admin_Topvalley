import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ["present", "absent"], required: true },
    // Each "Present" mark on a day starts a 30-minute session; a day can hold several.
    sessions: [{ _id: false, startedAt: { type: Date, required: true }, endsAt: { type: Date }, pausedLeft: { type: Number } }],
  },
  { timestamps: true },
);

attendanceSchema.index({ member: 1, date: 1 }, { unique: true });

export default mongoose.model("Attendance", attendanceSchema);
