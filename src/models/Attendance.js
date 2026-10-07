import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ["present", "absent"], required: true },
  },
  { timestamps: true },
);

attendanceSchema.index({ member: 1, date: 1 }, { unique: true });

export default mongoose.model("Attendance", attendanceSchema);
