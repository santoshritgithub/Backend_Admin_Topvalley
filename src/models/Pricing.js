import mongoose from "mongoose";

const plan = { d7: { type: Number, min: 0, default: 0 }, d15: { type: Number, min: 0, default: 0 }, d30: { type: Number, min: 0, default: 0 } };

// Single document holding the fee for every vehicle x plan combination.
const pricingSchema = new mongoose.Schema(
  {
    key: { type: String, default: "pricing", unique: true },
    scooter: plan,
    bike: plan,
    car: plan,
  },
  { timestamps: true, minimize: false },
);

export default mongoose.model("Pricing", pricingSchema);
