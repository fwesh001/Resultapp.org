"use client";

import { useState } from "react";
import { PageHero } from "@/components/ui/PageHero";
import { BugReportForm } from "@/components/forms/BugReportForm";
import { FeedbackForm } from "@/components/forms/FeedbackForm";
import { Bug, Lightbulb } from "lucide-react";

export default function SupportPage() {
  const [tab, setTab] = useState<"bug" | "feedback">("bug");

  return (
    <div className="min-h-screen bg-surface-0 text-text-1">
      <PageHero title="Support Hub" />

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mx-auto flex w-fit items-center rounded-full border border-line-1 bg-surface-1 p-1">
          <button
            onClick={() => setTab("bug")}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition ${
              tab === "bug" ? "bg-accent text-accent-fg shadow-[0_0_16px_rgba(147,51,234,0.35)]" : "text-accent hover:text-text-1"
            }`}
          >
            <Bug className="h-4 w-4" /> Report a Bug
          </button>
          <button
            onClick={() => setTab("feedback")}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition ${
              tab === "feedback" ? "bg-accent text-accent-fg shadow-[0_0_16px_rgba(147,51,234,0.35)]" : "text-accent hover:text-text-1"
            }`}
          >
            <Lightbulb className="h-4 w-4" /> Give Feedback
          </button>
        </div>

        <div className="mx-auto mt-8 max-w-2xl">
          {tab === "bug" ? <BugReportForm /> : <FeedbackForm />}
        </div>
      </div>
    </div>
  );
}
