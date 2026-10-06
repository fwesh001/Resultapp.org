"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Calculator,
  Globe,
  FileSpreadsheet,
  Users,
  Check,
  Sparkles,
  MousePointerClick,
} from "lucide-react";

export default function FeaturesGrid() {
  const [concept, setConcept] = useState<1 | 2 | 3>(1);
  return (
    <div>
      <div className="mb-5 flex items-center justify-center gap-2">
        {([1, 2, 3] as const).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setConcept(n)}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
              concept === n
                ? "border-purple-400/60 bg-purple-600/30 text-white"
                : "border-purple-500/20 bg-purple-900/10 text-purple-200/60 hover:text-purple-100"
            }`}
          >
            Design {n}
          </button>
        ))}
      </div>
      {concept === 2 ? <SpotlightGrid /> : concept === 3 ? <FocusGrid /> : <FlipGrid />}
    </div>
  );
}

type Card = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  problem: string;
  solution: string;
};

const CARDS: Card[] = [
  {
    title: "Automated Grading",
    icon: Calculator,
    problem: "Teachers spend hours doing math and making calculation errors.",
    solution: "Scores auto-calculate instantly with zero mistakes.",
  },
  {
    title: "Parent Portal",
    icon: Users,
    problem: "Printing paper report cards is slow and expensive.",
    solution: "Parents view secure digital report cards on their phones.",
  },
  {
    title: "Custom Subdomains",
    icon: Globe,
    problem: "Schools look unprofessional sharing generic website links.",
    solution: "Get your own custom, branded web address instantly.",
  },
  {
    title: "Bulk Onboarding",
    icon: FileSpreadsheet,
    problem: "Typing hundreds of student names takes days.",
    solution: "Upload a spreadsheet and enroll everyone in seconds.",
  },
];

function useReveal() {
  const [revealed, setRevealed] = useState(false);
  return { revealed, setRevealed, toggle: () => setRevealed((v) => !v) };
}

function TapCue({ revealed }: { revealed: boolean }) {
  return (
    <span
      className={`absolute bottom-3 right-3 inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-purple-300/60 transition-opacity md:hidden ${
        revealed ? "opacity-0" : "animate-pulse opacity-100"
      }`}
    >
      <MousePointerClick className="h-3 w-3" /> Tap to reveal
    </span>
  );
}

const glassBase =
  "aspect-square w-full overflow-hidden rounded-2xl border border-purple-600/30 bg-[#130926]/60 backdrop-blur-md";

/* ---------------- Concept 1: 3D Glass Flip ---------------- */

function FlipGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-5">
      {CARDS.map((card) => (
        <FlipCard key={card.title} card={card} />
      ))}
    </div>
  );
}

function FlipCard({ card }: { card: Card }) {
  const { revealed, setRevealed, toggle } = useReveal();
  const reduce = useReducedMotion();
  const Icon = card.icon;
  const flipped = revealed;

  return (
    <motion.button
      type="button"
      onClick={toggle}
      onMouseEnter={() => {
        if (window.matchMedia("(hover: hover)").matches) setRevealed(true);
      }}
      onMouseLeave={() => {
        if (window.matchMedia("(hover: hover)").matches) setRevealed(false);
      }}
      onViewportEnter={() => setRevealed(true)}
      viewport={{ amount: 0.6, once: false }}
      className="block w-full cursor-pointer text-left md:cursor-default"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl">
        {/* Front — Problem: slides out to the left */}
        <motion.div
          initial={false}
          animate={{ x: flipped && !reduce ? "-100%" : "0%", opacity: flipped ? 0 : 1 }}
          transition={{ duration: reduce ? 0 : 0.45, ease: "easeInOut" }}
          className={`${glassBase} absolute inset-0 flex flex-col justify-between p-4 md:p-5`}
        >
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-purple-300/70">
              {card.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-purple-100/80">
              {card.problem}
            </p>
          </div>
          <TapCue revealed={revealed} />
        </motion.div>

        {/* Back — Solution: slides in from the right, same spot */}
        <motion.div
          initial={false}
          animate={{ x: flipped ? "0%" : "100%", opacity: flipped ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.45, ease: "easeInOut" }}
          className={`${glassBase} absolute inset-0 flex flex-col justify-between border-purple-400/50 bg-[#1b0f38]/70 p-4 shadow-[0_0_50px_rgba(147,51,234,0.35)] md:p-5`}
        >
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-purple-400/40 bg-purple-600/30 text-purple-200">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-purple-300">
              {card.title}
            </h3>
            <p className="mt-2 bg-gradient-to-r from-purple-300 to-fuchsia-300 bg-clip-text text-sm font-medium leading-6 text-transparent">
              {card.solution}
            </p>
          </div>
          <TapCue revealed={!revealed} />
        </motion.div>
      </div>
    </motion.button>
  );
}

/* ---------------- Concept 2: Neon Spotlight Reveal ---------------- */

function SpotlightGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-5">
      {CARDS.map((card) => (
        <SpotlightCard key={card.title} card={card} />
      ))}
    </div>
  );
}

function SpotlightCard({ card }: { card: Card }) {
  const { revealed, setRevealed, toggle } = useReveal();
  const ref = useRef<HTMLButtonElement>(null);
  const Icon = card.icon;

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={toggle}
      onMouseMove={onMove}
      onMouseEnter={() => {
        if (window.matchMedia("(hover: hover)").matches) setRevealed(true);
      }}
      onMouseLeave={() => {
        if (window.matchMedia("(hover: hover)").matches) setRevealed(false);
      }}
      onViewportEnter={() => setRevealed(true)}
      viewport={{ amount: 0.6, once: false }}
      className={`relative ${glassBase} group block cursor-pointer p-4 md:p-5 text-left transition-colors duration-300 md:cursor-default md:p-5 ${
        revealed ? "border-[#9333ea]/70" : "border-transparent"
      }`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(300px circle at var(--mx, 50%) var(--my, 50%), rgba(147,51,234,0.28), transparent 70%)",
        }}
      />
      <div className="relative flex h-full flex-col justify-between">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
          <Icon className="h-5 w-5" />
        </div>
        <div className="relative min-h-[6.5rem]">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-purple-300/70">
            {card.title}
          </h3>
          <p
            className={`mt-3 text-base leading-7 text-purple-100/80 transition-all duration-300 md:text-lg ${
              revealed ? "-translate-y-3 opacity-0" : "translate-y-0 opacity-100"
            }`}
          >
            {card.problem}
          </p>
          <motion.div
            initial={false}
            animate={{ opacity: revealed ? 1 : 0, y: revealed ? 0 : 24 }}
            transition={{ duration: 0.35 }}
            className="absolute inset-x-0 top-8"
          >
            <p className="flex items-start gap-2 bg-gradient-to-r from-purple-300 to-fuchsia-300 bg-clip-text text-base font-medium leading-7 text-transparent md:text-lg">
              <Check className="mt-1 h-4 w-4 shrink-0 text-purple-400" />
              {card.solution}
            </p>
          </motion.div>
        </div>
      </div>
      <TapCue revealed={revealed} />
    </motion.button>
  );
}

/* ---------------- Concept 3: Expanding Focus Cards ---------------- */

function FocusGrid() {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-5">
      {CARDS.map((card, i) => (
        <FocusCard
          key={card.title}
          card={card}
          dimmed={hovered !== null && hovered !== i}
          onHover={(v) => setHovered(v ? i : null)}
        />
      ))}
    </div>
  );
}

function FocusCard({
  card,
  dimmed,
  onHover,
}: {
  card: Card;
  dimmed: boolean;
  onHover: (v: boolean) => void;
}) {
  const { revealed, setRevealed, toggle } = useReveal();
  const Icon = card.icon;

  return (
    <motion.button
      type="button"
      onClick={toggle}
      onMouseEnter={() => {
        if (window.matchMedia("(hover: hover)").matches) {
          setRevealed(true);
          onHover(true);
        }
      }}
      onMouseLeave={() => {
        if (window.matchMedia("(hover: hover)").matches) {
          setRevealed(false);
          onHover(false);
        }
      }}
      onViewportEnter={() => setRevealed(true)}
      viewport={{ amount: 0.6, once: false }}
      animate={{ scale: revealed ? 1.05 : 1, opacity: dimmed ? 0.55 : 1 }}
      transition={{ duration: 0.3 }}
      className={`relative ${glassBase} block cursor-pointer p-5 text-left md:cursor-default md:p-5 ${
        revealed
          ? "border-purple-400/50 shadow-[0_0_60px_rgba(147,51,234,0.4)]"
          : "shadow-none"
      }`}
    >
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
            <Icon className="h-5 w-5" />
          </div>
          <h3
            className={`text-sm font-semibold uppercase tracking-widest transition-all duration-300 ${
              revealed ? "text-purple-300" : "text-purple-300/70"
            }`}
          >
            {card.title}
          </h3>
        </div>

        <div className="relative mt-6 min-h-[6rem]">
          <p
            className={`text-base leading-7 text-purple-100/80 transition-all duration-300 md:text-lg ${
              revealed
                ? "absolute left-0 top-0 -translate-y-2 text-xs opacity-50"
                : "translate-y-0 opacity-100"
            }`}
          >
            {card.problem}
          </p>
          <motion.p
            initial={false}
            animate={{ opacity: revealed ? 1 : 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-x-0 top-6 text-sm font-medium leading-6 text-white"
          >
            {card.solution}
          </motion.p>
        </div>
      </div>
      <TapCue revealed={revealed} />
    </motion.button>
  );
}
