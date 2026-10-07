import mongoose from "mongoose";

// Remembers the last day each scheduled job ran, so a job fires at most once per day.
const jobRunSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  lastRunDate: { type: String, required: true }, // YYYY-MM-DD in the business timezone
});

export default mongoose.model("JobRun", jobRunSchema);
