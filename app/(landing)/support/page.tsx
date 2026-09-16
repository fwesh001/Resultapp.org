"use client";

import { useState } from "react";
import { PageHero } from "@/components/ui/PageHero";
import { BugReportForm } from "@/components/forms/BugReportForm";
import { FeedbackForm } from "@/components/forms/FeedbackForm";
import { Bug, Lightbulb } from "lucide-react";

export default function SupportPage() {
  const [tab, setTab] = useState<"bug" | "feedback">("bug");

  return (
    <div className="min-h-screen bg-[#0B0514] text-purple-50">
      <PageHero title="Support Hub" />

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mx-auto flex w-fit items-center rounded-full border border-purple-500/15 bg-purple-900/10 p-1 backdrop-blur">
          <button
            onClick={() => setTab("bug")}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition ${
              tab === "bug" ? "bg-purple-600 text-white shadow-[0_0_16px_rgba(147,51,234,0.35)]" : "text-purple-300 hover:text-white"
            }`}
          >
            <Bug className="h-4 w-4" /> Report a Bug
          </button>
          <button
            onClick={() => setTab("feedback")}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition ${
              tab === "feedback" ? "bg-purple-600 text-white shadow-[0_0_16px_rgba(147,51,234,0.35)]" : "text-purple-300 hover:text-white"
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
