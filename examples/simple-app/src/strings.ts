/**
 * strings.ts — every user-facing string the app renders, declared once.
 *
 * This is the single source of truth. The same file is:
 *   1. imported by the React components for type-safe resolution, and
 *   2. fed to `stringlocale compile` to generate the locale bundles.
 */
import { Param, StringLocale } from "stringlocale";

export const greeting = new StringLocale("{name}, your account is ready", {
  id: "greeting",
  params: { name: Param.literal() },
  gendered: true,
});

export const followers = new StringLocale("{n} followers", {
  id: "followers",
  params: { n: Param.number() },
});

export const inbox = new StringLocale("You have {count} messages", {
  id: "inbox",
  params: { count: Param.plural() },
});

export const fee = new StringLocale("{creator} charges {amount} per post", {
  id: "fee",
  params: { creator: Param.literal(), amount: Param.currency("NPR") },
});

export const campaignStatus = new StringLocale("Campaign is {status}", {
  id: "campaign_status",
  params: {
    status: Param.translatable(["approved", "pending", "rejected"], {
      context: "campaign review status",
    }),
  },
});

export const deadline = new StringLocale("Deliver by {date}", {
  id: "deadline",
  params: { date: Param.date("long") },
});
