import Member from "./models/Member.js";
import Notification from "./models/Notification.js";
import { usedOf } from "./rides.js";
import { todayStr } from "./dates.js";

const dueOf = (m) => Math.max(0, (m.amount || 0) - (m.amountPaid || 0));

// Part payment: the learner may use graceDays plan days on credit. Once every allowed day is marked
// and the balance is still unpaid, no further day can be marked.
export const creditUsedUp = (m) => m.graceDays > 0 && dueOf(m) > 0 && (m.slots || []).length >= m.graceDays;

export const creditMessage = (m) =>
  `${m.name} has used the ${m.graceDays} allowed day${m.graceDays === 1 ? "" : "s"} and still owes Rs ${dueOf(m).toLocaleString()}`;

// One payment_overdue alert per member.
export async function raiseOverdue(m) {
  if (await Notification.exists({ member: m._id, type: "payment_overdue" })) return;
  await Notification.create({ member: m._id, type: "payment_overdue", memberName: m.name, date: todayStr(), message: creditMessage(m), read: false }).catch(() => {});
}

// Alert once the allowed days are used up (rides finished / absent) or already exceeded.
export async function checkOverduePayments() {
  const members = await Member.find({ graceDays: { $gt: 0 } });
  for (const m of members) {
    if (dueOf(m) <= 0) continue;
    if (usedOf(m) >= m.graceDays || (m.slots || []).length > m.graceDays) await raiseOverdue(m);
  }
}
