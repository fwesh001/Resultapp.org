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

// Helper to switch concepts while deciding. Set to 1, 2, or 3.
const CONCEPT: 1 | 2 | 3 = 1;

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

export default function FeaturesGrid() {
  if (CONCEPT === 2) return <SpotlightGrid />;
  if (CONCEPT === 3) return <FocusGrid />;
  return <FlipGrid />;
}

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
  "relative aspect-square w-full overflow-hidden rounded-2xl border border-purple-600/30 bg-[#130926]/60 backdrop-blur-md";

/* ---------------- Concept 1: 3D Glass Flip ---------------- */

function FlipGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
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
      className="block w-full cursor-pointer text-left [perspective:1200px] md:cursor-default"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <motion.div
        animate={{ rotateY: flipped && !reduce ? 180 : 0 }}
        transition={{ duration: reduce ? 0 : 0.6, ease: [0.32, 0.72, 0, 1] }}
        className="relative aspect-square w-full"
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* Front — Problem */}
        <div
          className={`${glassBase} absolute inset-0 flex flex-col justify-between p-5 md:p-6`}
          style={{ backfaceVisibility: "hidden" }}
        >
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-purple-300/70">
              {card.title}
            </h3>
            <p className="mt-3 text-base leading-7 text-purple-100/80 md:text-lg">
              {card.problem}
            </p>
          </div>
          <TapCue revealed={revealed} />
        </div>

        {/* Back — Solution */}
        <div
          className={`${glassBase} absolute inset-0 flex flex-col justify-between border-purple-400/50 bg-[#1b0f38]/70 p-5 shadow-[0_0_50px_rgba(147,51,234,0.35)] md:p-6`}
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-purple-400/40 bg-purple-600/30 text-purple-200">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-purple-300">
              {card.title}
            </h3>
            <p className="mt-3 bg-gradient-to-r from-purple-300 to-fuchsia-300 bg-clip-text text-base font-medium leading-7 text-transparent md:text-lg">
              {card.solution}
            </p>
          </div>
          <TapCue revealed={!revealed} />
        </div>
      </motion.div>
    </motion.button>
  );
}

/* ---------------- Concept 2: Neon Spotlight Reveal ---------------- */

function SpotlightGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
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
      className={`${glassBase} group block cursor-pointer p-5 text-left transition-colors duration-300 md:cursor-default md:p-6 ${
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
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
          <Icon className="h-5 w-5" />
        </div>
        <div className="relative min-h-[7.5rem]">
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
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
      className={`${glassBase} block cursor-pointer p-5 text-left md:cursor-default md:p-6 ${
        revealed
          ? "border-purple-400/50 shadow-[0_0_60px_rgba(147,51,234,0.4)]"
          : "shadow-none"
      }`}
    >
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
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
            className="absolute inset-x-0 top-6 text-base font-medium leading-7 text-white md:text-lg"
          >
            {card.solution}
          </motion.p>
        </div>
      </div>
      <TapCue revealed={revealed} />
    </motion.button>
  );
}
