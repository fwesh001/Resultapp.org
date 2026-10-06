"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  FileCheck2,
  Smartphone,
  ShieldCheck,
  Coins,
  Sparkles,
  MousePointerClick,
} from "lucide-react";

type Card = {
  kicker: string;
  icon: React.ComponentType<{ className?: string }>;
  problemTitle: string;
  problemBody: string;
  solutionTitle: string;
  solutionBody: string;
};

const CARDS: Card[] = [
  {
    kicker: "Grading & Reporting",
    icon: FileCheck2,
    problemTitle: "Manual Grading",
    problemBody:
      "Teachers spend hours calculating scores, making mistakes, and writing out report cards by hand.",
    solutionTitle: "Automated Results",
    solutionBody:
      "Scores calculate instantly and error-free, generating digital report cards in seconds.",
  },
  {
    kicker: "Accessibility",
    icon: Smartphone,
    problemTitle: "Tied to the Desk",
    problemBody:
      "Teachers have to stay late at school or wait in line to use the office computer just to enter scores.",
    solutionTitle: "Grade From Anywhere",
    solutionBody:
      "Teachers can securely enter scores from their own phones or laptops, whether at school or at home.",
  },
  {
    kicker: "Security",
    icon: ShieldCheck,
    problemTitle: "Lost Records",
    problemBody:
      "Paper files get damaged, and local spreadsheets are easily lost to computer crashes or viruses.",
    solutionTitle: "Secure Cloud Backup",
    solutionBody:
      "Your school's entire academic history is safely backed up online and protected forever.",
  },
  {
    kicker: "Cost Efficiency",
    icon: Coins,
    problemTitle: "Monthly Subscriptions",
    problemBody:
      "Expensive software forces you to pay monthly fees, even during long school holidays.",
    solutionTitle: "Pay-As-You-Grow",
    solutionBody:
      "Buy student slots once. No recurring fees, no subscriptions, and your credits never expire.",
  },
];

function useReveal() {
  const [revealed, setRevealed] = useState(false);
  return { revealed, setRevealed, toggle: () => setRevealed((v) => !v) };
}

function TapCue({ revealed }: { revealed: boolean }) {
  return (
    <span
      className={`absolute bottom-3 right-3 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-purple-300/60 transition-opacity md:hidden ${
        revealed ? "opacity-0" : "animate-pulse opacity-100"
      }`}
    >
      <MousePointerClick className="h-3 w-3" /> Tap to reveal
    </span>
  );
}

export default function FeaturesGrid() {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-5">
      {CARDS.map((card, i) => (
        <FeatureCard
          key={card.kicker}
          card={card}
          dimmed={hovered !== null && hovered !== i}
          onHover={(v) => setHovered(v ? i : null)}
        />
      ))}
    </div>
  );
}

function FeatureCard({
  card,
  dimmed,
  onHover,
}: {
  card: Card;
  dimmed: boolean;
  onHover: (v: boolean) => void;
}) {
  const { revealed, setRevealed, toggle } = useReveal();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLButtonElement>(null);
  const Icon = card.icon;

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const hoverable = () =>
    typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={toggle}
      onMouseMove={onMove}
      onMouseEnter={() => {
        if (hoverable()) {
          setRevealed(true);
          onHover(true);
        }
      }}
      onMouseLeave={() => {
        if (hoverable()) {
          setRevealed(false);
          onHover(false);
        }
      }}
      onViewportEnter={() => setRevealed(true)}
      viewport={{ amount: 0.6, once: false }}
      animate={{ scale: revealed && !reduce ? 1.05 : 1, opacity: dimmed ? 0.55 : 1 }}
      transition={{ duration: reduce ? 0 : 0.3 }}
      className={`group relative aspect-square w-full cursor-pointer overflow-hidden rounded-2xl border text-left backdrop-blur-md transition-colors duration-300 md:cursor-default ${
        revealed
          ? "border-[#9333ea]/70 bg-[#130926]/60 shadow-[0_0_50px_rgba(147,51,234,0.35)]"
          : "border-purple-600/30 bg-[#130926]/60"
      }`}
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {/* cursor-follow neon glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(300px circle at var(--mx, 50%) var(--my, 50%), rgba(147,51,234,0.28), transparent 70%)",
        }}
      />

      <div className="relative h-full overflow-hidden">
        {/* Problem face */}
        <motion.div
          initial={false}
          animate={{ x: revealed && !reduce ? "-100%" : "0%", opacity: revealed ? 0 : 1 }}
          transition={{ duration: reduce ? 0 : 0.45, ease: "easeInOut" }}
          className="absolute inset-0 flex flex-col p-4 md:p-5"
        >
          <FaceHeader
            icon={<Icon className="h-4 w-4" />}
            kicker={card.kicker}
            title={card.problemTitle}
          />
          <p className="mt-4 text-sm leading-6 text-purple-100/80">
            {card.problemBody}
          </p>
          <TapCue revealed={revealed} />
        </motion.div>

        {/* Solution face */}
        <motion.div
          initial={false}
          animate={{ x: revealed ? "0%" : "100%", opacity: revealed ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.45, ease: "easeInOut" }}
          className="absolute inset-0 flex flex-col p-4 md:p-5"
        >
          <FaceHeader
            icon={<Sparkles className="h-4 w-4" />}
            kicker={card.kicker}
            title={card.solutionTitle}
            accent
          />
          <p className="mt-4 bg-gradient-to-r from-purple-300 to-fuchsia-300 bg-clip-text text-sm font-medium leading-6 text-transparent">
            {card.solutionBody}
          </p>
          <TapCue revealed={!revealed} />
        </motion.div>
      </div>
    </motion.button>
  );
}

function FaceHeader({
  icon,
  kicker,
  title,
  accent,
}: {
  icon: React.ReactNode;
  kicker: string;
  title: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <div
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
            accent
              ? "border-purple-400/40 bg-purple-600/30 text-purple-200"
              : "border-purple-500/20 bg-purple-600/15 text-purple-300"
          }`}
        >
          {icon}
        </div>
        <h3
          className={`text-sm font-semibold tracking-tight ${
            accent ? "text-purple-200" : "text-white"
          }`}
        >
          {title}
        </h3>
      </div>
      <div className="mt-3 h-px w-full bg-gradient-to-r from-purple-500/50 via-purple-500/20 to-transparent" />
      <p className="mt-2 text-[10px] font-medium uppercase tracking-widest text-purple-300/50">
        {kicker}
      </p>
    </div>
  );
}
