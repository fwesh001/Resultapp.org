"use client";

import { useState } from "react";
import { Star, Lightbulb, CheckCircle2 } from "lucide-react";

export function FeedbackForm() {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-400" />
        <h3 className="mt-3 text-lg font-semibold text-white">Feedback sent!</h3>
        <p className="mt-1 text-sm text-purple-200/60">We love your ideas — thank you.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-purple-500/15 bg-purple-900/10 p-6 backdrop-blur">
      <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-200">
        <Lightbulb className="h-3.5 w-3.5" /> Share an Idea
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="feedback-idea" className="text-sm font-medium text-purple-100">Your idea</label>
        <textarea
          id="feedback-idea"
          name="idea"
          required
          rows={4}
          placeholder="I wish ResultApp could..."
          className="flex min-h-[120px] w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span id="feedback-rating-label" className="text-sm font-medium text-purple-100">Rate your experience</span>
        <div className="flex items-center gap-1" role="group" aria-labelledby="feedback-rating-label">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(n)}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition"
              aria-label={`Rate ${n} stars`}
              aria-pressed={rating === n}
            >
              <Star
                className={`h-7 w-7 transition ${
                  (hover || rating) >= n ? "fill-purple-500 text-purple-500 drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]" : "text-purple-800"
                }`}
              />
            </button>
          ))}
          <span className="ml-2 text-sm text-purple-300">{rating ? `${rating}/5` : "Tap a star"}</span>
        </div>
      </div>

      <button
        type="submit"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(147,51,234,0.35)] hover:bg-purple-500 animate-pulse hover:animate-none"
      >
        Send Feedback
      </button>
    </form>
  );
}
