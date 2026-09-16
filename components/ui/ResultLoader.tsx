"use client";

import { motion } from "framer-motion";

export default function ResultLoader() {
  return (
    <div className="flex flex-col items-center justify-center">
      {/* Gyroscope Container */}
      <div className="w-32 h-32 flex items-center justify-center relative">
        {/* Ring 1 (Outer) */}
        <motion.div
          className="absolute w-full h-full rounded-full border-t-2 border-b-2 border-purple-600/80 shadow-[0_0_15px_rgba(147,51,234,0.3)]"
          initial={{ rotateZ: 0, rotateX: 0 }}
          animate={{ rotateZ: 360, rotateX: 180 }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Ring 2 (Middle) */}
        <motion.div
          className="absolute w-24 h-24 rounded-full border-l-2 border-r-2 border-purple-400/80 shadow-[0_0_15px_rgba(147,51,234,0.3)]"
          initial={{ rotateZ: 360, rotateY: 0 }}
          animate={{ rotateZ: 0, rotateY: 180 }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Ring 3 (Inner) */}
        <motion.div
          className="absolute w-16 h-16 rounded-full border-t-2 border-b-2 border-purple-200/80 shadow-[0_0_15px_rgba(147,51,234,0.3)]"
          initial={{ rotateX: 360 }}
          animate={{ rotateX: 0 }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Core */}
        <motion.div
          className="w-6 h-6 bg-purple-500 rounded-full shadow-[0_0_20px_#a855f7]"
          animate={{
            scale: [0.8, 1.2],
            opacity: [0.7, 1],
          }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            repeatType: "mirror",
            ease: "easeInOut",
          }}
        />
      </div>

      {/* Loading Text */}
      <motion.p
        className="text-purple-300 font-mono text-sm tracking-widest mt-8"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        COMPILING_DATA...
      </motion.p>
    </div>
  );
}
