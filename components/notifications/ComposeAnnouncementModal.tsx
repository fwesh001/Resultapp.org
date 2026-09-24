"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

export const ANNOUNCEMENT_TYPES = ["Meeting", "Urgent", "Reminder", "General"] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

export interface AnnouncementPayload {
  message_type: AnnouncementType;
  title: string;
  message: string;
}

interface ComposeAnnouncementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sending: boolean;
  onSubmit: (payload: AnnouncementPayload) => void;
}

/** Tenant-admin announcement composer (staff_only broadcast). */
export default function ComposeAnnouncementModal({
  open,
  onOpenChange,
  sending,
  onSubmit,
}: ComposeAnnouncementModalProps) {
  const [messageType, setMessageType] = useState<AnnouncementType>("General");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !message.trim() || sending) return;
    onSubmit({ message_type: messageType, title: title.trim(), message: message.trim() });
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Compose Announcement"
      description="Broadcast a categorized message to all active staff."
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="ann-type" className="mb-1 block text-sm font-medium text-zinc-200">
            Type
          </label>
          <select
            id="ann-type"
            value={messageType}
            onChange={(e) => setMessageType(e.target.value as AnnouncementType)}
            className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none"
          >
            {ANNOUNCEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ann-title" className="mb-1 block text-sm font-medium text-zinc-200">
            Title
          </label>
          <input
            id="ann-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            placeholder="Staff Briefing"
            className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="ann-message" className="mb-1 block text-sm font-medium text-zinc-200">
            Message
          </label>
          <textarea
            id="ann-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            maxLength={2000}
            rows={5}
            placeholder="All teachers should…"
            className="w-full rounded-lg border border-purple-500/20 bg-[#0B0514] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={sending || !title.trim() || !message.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Sending…" : "Send to staff"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
