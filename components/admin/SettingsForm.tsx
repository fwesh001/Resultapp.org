"use client";

import type { School } from "@/types/school";

interface SettingsFormProps {
  school: School | null;
}

/**
 * Client-side school profile form.
 * Rendered by the settings Server Component with real tenant data
 * as input defaultValues.
 */
export default function SettingsForm({ school }: SettingsFormProps) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
  }

  const inputClassName =
    "mt-2 w-full rounded-xl border border-purple-500/20 bg-[#0B0514] px-4 py-3 text-white placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50";

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 space-y-4 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-6"
    >
      <div>
        <label
          htmlFor="school-name"
          className="block text-sm font-medium text-purple-200"
        >
          School name
        </label>
        <input
          id="school-name"
          name="name"
          type="text"
          defaultValue={school?.name ?? ""}
          placeholder="e.g. Victory High School"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-motto"
          className="block text-sm font-medium text-purple-200"
        >
          Motto
        </label>
        <input
          id="school-motto"
          name="motto"
          type="text"
          defaultValue={school?.motto ?? ""}
          placeholder="e.g. Excellence through discipline"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-email"
          className="block text-sm font-medium text-purple-200"
        >
          Email
        </label>
        <input
          id="school-email"
          name="email"
          type="email"
          defaultValue={school?.email ?? ""}
          placeholder="e.g. info@school.edu"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-phone"
          className="block text-sm font-medium text-purple-200"
        >
          Phone
        </label>
        <input
          id="school-phone"
          name="phone"
          type="tel"
          defaultValue={school?.phone ?? ""}
          placeholder="e.g. +234 800 000 0000"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-address"
          className="block text-sm font-medium text-purple-200"
        >
          Address
        </label>
        <textarea
          id="school-address"
          name="address"
          rows={3}
          defaultValue={school?.address ?? ""}
          placeholder="School address"
          className={inputClassName}
        />
      </div>

      <button
        type="submit"
        className="w-full rounded-xl bg-purple-600 px-4 py-3 font-semibold text-white transition hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-[#0B0514]"
      >
        Save Changes
      </button>
    </form>
  );
}
