import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Booking, Notification } from "@/lib/models/booking";
import { Center, Organization } from "@/lib/models/core";
import { reminderMessage } from "./messages";

// F3.4 — Rappels automatiques : un message par rendez-vous confirmé dans les prochaines 24 h,
// uniquement si le client a donné son consentement (cahier des charges §7).
// Déclenché chaque heure par /api/cron/reminders, ou à la main depuis le calendrier.

export const REMINDER_WINDOW_H = 24;

export async function sendDueReminders(options: { organizationId?: string; centerId?: string; now?: Date } = {}) {
  await connectDB();
  const now = options.now ?? new Date();
  const until = new Date(now.getTime() + REMINDER_WINDOW_H * 3_600_000);

  const due = await Booking.find({
    ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    ...(options.centerId ? { centerId: options.centerId } : {}),
    status: "CONFIRMED",
    reminderSentAt: null,
    start: { $gt: now, $lte: until },
  })
    .populate<{ customerId: { _id: Types.ObjectId; firstName: string; phone: string; remindersConsent: boolean } }>(
      "customerId",
      "firstName phone remindersConsent",
    )
    .lean();

  const orgIds = [...new Set(due.map((b) => String(b.organizationId)))];
  const centerIds = [...new Set(due.map((b) => String(b.centerId)))];
  const [orgs, centers] = await Promise.all([
    Organization.find({ _id: { $in: orgIds } }).select("name").lean(),
    Center.find({ _id: { $in: centerIds } }).select("name").lean(),
  ]);
  const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));
  const centerName = new Map(centers.map((c) => [String(c._id), c.name]));

  let sent = 0;
  let skipped = 0;
  for (const b of due) {
    // On marque d'abord le rendez-vous : deux déclenchements simultanés n'envoient qu'un rappel.
    const claimed = await Booking.updateOne({ _id: b._id, reminderSentAt: null }, { reminderSentAt: now });
    if (claimed.modifiedCount === 0) continue;
    if (!b.customerId.remindersConsent) {
      skipped++;
      continue;
    }
    await Notification.create({
      organizationId: b.organizationId,
      bookingId: b._id,
      customerId: b.customerId._id,
      kind: "REMINDER",
      to: b.customerId.phone,
      message: reminderMessage({
        firstName: b.customerId.firstName,
        salon: orgName.get(String(b.organizationId)) ?? "",
        center: centerName.get(String(b.centerId)) ?? "",
        start: b.start,
        services: b.packName ?? b.items.map((i) => i.name).join(", "),
      }),
    });
    sent++;
  }
  return { sent, skipped, checked: due.length };
}
