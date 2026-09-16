"use client";

import { motion, AnimatePresence } from "framer-motion";
import ResultLoader from "@/components/ui/ResultLoader";

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
}

export default function LoadingOverlay({ isVisible, message }: LoadingOverlayProps) {
  if (!isVisible) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0B0514]/80 backdrop-blur-sm"
        >
          <ResultLoader message={message} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
