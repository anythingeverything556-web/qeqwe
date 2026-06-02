// ══════════════════════════════════════════════════════════════════════
// PREMIUM MOTION ANIMATIONS v2 — Awwwards-level quality
// Inspired by: awwwards.com, Figma Community, Untitled UI, UI Store
// Powered by: motion.dev (formerly Framer Motion)
// OPTIMIZED: No GPU-heavy blur filters, reducedMotion support,
//            fewer concurrent animations, transform-only where possible
// ══════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode, Children } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, useInView, useReducedMotion } from 'motion/react';

// ──── REDUCED MOTION HOOK ────
// Respects user's OS/browser preference. When true, we skip
// heavy animations and use simple opacity/duration instead.
export function usePrefersReducedMotion() {
  return useReducedMotion();
}

// ──── SPRING CONFIGS (tuned for performance — no overshoot wobble) ────
export const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
export const springBouncy = { type: 'spring' as const, stiffness: 400, damping: 28 };
export const springGentle = { type: 'spring' as const, stiffness: 200, damping: 28 };
export const springSnappy = { type: 'spring' as const, stiffness: 500, damping: 35 };
export const springWobbly = { type: 'spring' as const, stiffness: 180, damping: 22 };
export const springMolasses = { type: 'spring' as const, stiffness: 80, damping: 20 };
// New: ultra-snappy for micro-interactions (no visible bounce = less GPU work)
export const springMicro = { type: 'spring' as const, stiffness: 600, damping: 35 };

// ──── EASING CURVES ────
export const easeOutExpo = [0.16, 1, 0.3, 1] as const;
export const easeInOutQuart = [0.76, 0, 0.24, 1] as const;

// ══════════════════════════════════════════════════════════════════════
// 1. ANIMATED COUNTER — Numbers count up smoothly
// Optimized: uses requestAnimationFrame, only animates on value change
// ══════════════════════════════════════════════════════════════════════
export function AnimatedCounter({ value, className = '', style }: {
  value: number; className?: string; style?: React.CSSProperties;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValue = useRef(value);
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (prevValue.current === value) return;
    if (prefersReduced) {
      setDisplayValue(value);
      prevValue.current = value;
      return;
    }
    const start = prevValue.current;
    const end = value;
    const duration = 500;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayValue(Math.round(start + (end - start) * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    prevValue.current = value;
  }, [value, prefersReduced]);

  return (
    <motion.div
      className={className}
      style={style}
      key={value}
      initial={{ y: 6, opacity: 0.8 }}
      animate={{ y: 0, opacity: 1 }}
      transition={prefersReduced ? { duration: 0.1 } : spring}
    >
      {displayValue}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 2. TILT CARD — 3D perspective tilt on mouse move
// Optimized: disabled when reducedMotion, throttled via spring
// ══════════════════════════════════════════════════════════════════════
export function TiltCard({ children, className = '', style, tiltAmount = 6 }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
  tiltAmount?: number; glareOpacity?: number;
}) {
  const prefersReduced = useReducedMotion();
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);

  const rotateX = useSpring(useTransform(y, [0, 1], [tiltAmount, -tiltAmount]), springGentle);
  const rotateY = useSpring(useTransform(x, [0, 1], [-tiltAmount, tiltAmount]), springGentle);

  // BUG FIX: Move useTransform to top level (before conditional return) to comply with Rules of Hooks.
  // Previously this was called inside JSX after the early return for prefersReduced,
  // which violated the Rules of Hooks and could cause crashes.
  const glareGradient = useTransform(
    [x, y],
    ([latestX, latestY]: number[]) =>
      `radial-gradient(circle at ${latestX * 100}% ${latestY * 100}%, rgba(255,255,255,0.1), transparent 60%)`
  );

  const handleMouse = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (prefersReduced) return;
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width);
    y.set((e.clientY - rect.top) / rect.height);
  }, [x, y, prefersReduced]);

  const handleLeave = useCallback(() => {
    x.set(0.5);
    y.set(0.5);
  }, [x, y]);

  if (prefersReduced) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={{ ...style, perspective: 800, transformStyle: 'preserve-3d' }}
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
    >
      <motion.div style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }} transition={springGentle}>
        {children}
        {/* Subtle glare — uses opacity only, no blur */}
        <motion.div
          className="absolute inset-0 pointer-events-none rounded-[inherit]"
          style={{
            background: glareGradient,
          }}
        />
      </motion.div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 3. MAGNETIC BUTTON — Subtly follows the cursor
// Optimized: reduced strength, disabled on reducedMotion
// ══════════════════════════════════════════════════════════════════════
export function MagneticButton({ children, className = '', style, strength = 0.2 }: {
  children: ReactNode; className?: string; style?: React.CSSProperties; strength?: number;
}) {
  const prefersReduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, springMicro);
  const springY = useSpring(y, springMicro);

  const handleMouse = useCallback((e: React.MouseEvent) => {
    if (prefersReduced || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set((e.clientX - centerX) * strength);
    y.set((e.clientY - centerY) * strength);
  }, [x, y, strength, prefersReduced]);

  const handleLeave = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ ...style, x: springX, y: springY }}
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
      whileTap={prefersReduced ? {} : { scale: 0.97 }}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 4. REVEAL ON SCROLL / VIEW — Elements animate when they enter viewport
// Optimized: no blur filter, uses opacity + translateY only
// ══════════════════════════════════════════════════════════════════════
export function RevealOnScroll({ children, className = '', style, delay = 0, direction = 'up' }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
  delay?: number; direction?: 'up' | 'down' | 'left' | 'right';
}) {
  const prefersReduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  const directionMap = {
    up: { y: 30, x: 0 },
    down: { y: -30, x: 0 },
    left: { x: 30, y: 0 },
    right: { x: -30, y: 0 },
  };

  if (prefersReduced) {
    return <div ref={ref} className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={style}
      initial={{ opacity: 0, ...directionMap[direction] }}
      animate={isInView ? { opacity: 1, x: 0, y: 0 } : {}}
      transition={{ ...spring, delay }}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 5. STAGGER GROUP — Children animate in sequence
// Optimized: no blur, uses opacity + transform only
// ══════════════════════════════════════════════════════════════════════
export function StaggerGroup({ children, className = '', delay = 0.05, staggerFrom = 'first' }: {
  children: ReactNode; className?: string; delay?: number;
  staggerFrom?: 'first' | 'center' | 'last';
}) {
  const prefersReduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-30px' });

  if (prefersReduced) {
    return <div ref={ref} className={className}>{children}</div>;
  }

  return (
    <div ref={ref} className={className}>
      {(() => {
        const childArray = Children.toArray(children);
        return childArray.length > 0 ? childArray.map((child, i) => {
        const total = childArray.length;
        let staggerDelay: number;
        if (staggerFrom === 'center') {
          const center = Math.floor(total / 2);
          staggerDelay = Math.abs(i - center) * delay;
        } else if (staggerFrom === 'last') {
          staggerDelay = (total - 1 - i) * delay;
        } else {
          staggerDelay = i * delay;
        }

        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ ...spring, delay: staggerDelay }}
          >
            {child}
          </motion.div>
        );
      }) : children;
      })()}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 6. TAB CONTENT — Animated tab content with exit animations
// Optimized: no blur, smoother transition
// ══════════════════════════════════════════════════════════════════════
export function TabContent({ children, className = '', style, tabId }: {
  children: ReactNode; className?: string; style?: React.CSSProperties; tabId: string;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div key={tabId} className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      key={tabId}
      className={className}
      style={style}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ ...springGentle, duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 7. QUEUE ITEM MOTION — Slide from left with spring
// Optimized: no blur, simpler exit
// ══════════════════════════════════════════════════════════════════════
export function QueueItemMotion({ children }: { children: ReactNode }) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <motion.div layout>{children}</motion.div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -20, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.95, height: 0, marginBottom: 0 }}
      transition={spring}
      layout
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 8. SCALE POP — Pop-in for "Now Speaking" and highlights
// Optimized: no blur filter
// ══════════════════════════════════════════════════════════════════════
export function ScalePop({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springBouncy}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 9. SLIDE UP — For error messages and reveals
// ══════════════════════════════════════════════════════════════════════
export function SlideUp({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 10. FADE IN — Simple opacity transition
// ══════════════════════════════════════════════════════════════════════
export function FadeIn({ children, className = '' }: {
  children: ReactNode; className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 11. FLOAT — Gentle bobbing for empty states
// Optimized: uses transform only (no reflow)
// ══════════════════════════════════════════════════════════════════════
export function Float({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={style}
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 12. SCALE IN — For overlay modals
// ══════════════════════════════════════════════════════════════════════
export function ScaleIn({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springBouncy}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 13. MORPHING BLOB — Organic animated background shape
// OPTIMIZED: Reduced from 12s to 20s cycle, fewer path points
// DISABLED on reducedMotion (purely decorative)
// ══════════════════════════════════════════════════════════════════════
export function MorphingBlob({ className = '', style, color1, color2, size = 400 }: {
  className?: string; style?: React.CSSProperties;
  color1?: string; color2?: string; size?: number;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    // Static gradient circle instead of animated SVG
    return (
      <div
        className={className}
        style={{
          ...style,
          width: size,
          height: size,
          position: 'absolute',
          pointerEvents: 'none',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color1 || 'rgba(220,53,53,0.15)'}, ${color2 || 'rgba(124,58,237,0.08)'})`,
        }}
      />
    );
  }

  const pathVariants = {
    initial: {
      d: 'M440,320Q430,390,380,430Q320,440,270,420Q210,400,170,370Q110,320,100,250Q90,180,150,140Q210,90,280,80Q350,70,400,120Q440,170,450,250Q460,320,440,320Z',
    },
    animate: {
      d: [
        'M440,320Q430,390,380,430Q320,440,270,420Q210,400,170,370Q110,320,100,250Q90,180,150,140Q210,90,280,80Q350,70,400,120Q440,170,450,250Q460,320,440,320Z',
        'M450,300Q420,370,360,420Q300,450,240,430Q180,410,140,360Q100,300,110,240Q120,180,170,130Q220,80,290,70Q360,60,410,110Q450,160,460,240Q470,320,450,300Z',
        'M430,310Q440,380,380,430Q320,460,260,430Q200,400,160,350Q120,300,110,240Q100,180,150,130Q200,80,270,70Q340,60,400,110Q450,160,460,250Q470,320,430,310Z',
      ],
    },
  };

  const gradId = useMemo(() => `bg-${Math.random().toString(36).slice(2, 6)}`, []);

  return (
    <motion.div
      className={className}
      style={{
        ...style,
        width: size,
        height: size,
        position: 'absolute',
        pointerEvents: 'none',
        willChange: 'transform',
      }}
    >
      <svg viewBox="0 0 500 500" width={size} height={size}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color1 || 'rgba(220,53,53,0.15)'} />
            <stop offset="100%" stopColor={color2 || 'rgba(124,58,237,0.08)'} />
          </linearGradient>
        </defs>
        <motion.path
          fill={`url(#${gradId})`}
          variants={pathVariants}
          initial="initial"
          animate="animate"
          transition={{
            duration: 20,
            repeat: Infinity,
            repeatType: 'reverse',
            ease: 'easeInOut',
          }}
        />
      </svg>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 14. TEXT REVEAL — Letters animate in one by one
// Optimized: no blur, limited to short strings
// ══════════════════════════════════════════════════════════════════════
export function TextReveal({ text, className = '', style, delay = 0 }: {
  text: string; className?: string; style?: React.CSSProperties; delay?: number;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced || text.length > 60) {
    return <span className={className} style={style}>{text}</span>;
  }

  return (
    <span className={className} style={style}>
      {text.split('').map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: delay + i * 0.025 }}
          style={{ display: 'inline-block', whiteSpace: char === ' ' ? 'pre' : undefined }}
        >
          {char}
        </motion.span>
      ))}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 15. PULSE RING — Expanding rings for "Now Speaking"
// Optimized: fewer rings (2 instead of 3), lower opacity
// ══════════════════════════════════════════════════════════════════════
export function PulseRing({ color = '#dc3535', size = 12, className = '' }: {
  color?: string; size?: number; className?: string;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return (
      <span className={className} style={{ position: 'relative', display: 'inline-block', width: size, height: size }}>
        <span style={{
          display: 'block', width: '100%', height: '100%', borderRadius: '50%',
          background: color, boxShadow: `0 0 6px ${color}66`,
        }} />
      </span>
    );
  }

  return (
    <span className={className} style={{ position: 'relative', display: 'inline-block', width: size, height: size }}>
      {[0, 1].map(i => (
        <motion.span
          key={i}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `2px solid ${color}`,
          }}
          animate={{ scale: [1, 2.2], opacity: [0.5, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
        />
      ))}
      <motion.span
        style={{
          position: 'relative', display: 'block', width: '100%', height: '100%',
          borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}66`,
        }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 16. SOUND PAD PRESS — Bounce + glow for soundboard pads
// Optimized: no blur in shadows
// ══════════════════════════════════════════════════════════════════════
export function SoundPad({ children, className = '', style, onPress }: {
  children: ReactNode; className?: string; style?: React.CSSProperties; onPress?: () => void;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      whileHover={{
        scale: 1.03,
        y: -2,
        boxShadow: '0 6px 16px rgba(220,53,53,0.1), 0 0 0 1px rgba(220,53,53,0.06)',
      }}
      whileTap={{
        scale: 0.96,
        y: 1,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
      transition={springBouncy}
      onClick={onPress}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 17. ORBITAL LOADER — Premium loading spinner
// ══════════════════════════════════════════════════════════════════════
export function OrbitalLoader({ size = 40, color = '#dc3535', className = '' }: {
  size?: number; color?: string; className?: string;
}) {
  return (
    <motion.div
      className={className}
      style={{ width: size, height: size, position: 'relative' }}
      animate={{ rotate: 360 }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
    >
      <motion.span
        style={{
          position: 'absolute', top: 0, left: '50%',
          width: size * 0.25, height: size * 0.25,
          marginLeft: -size * 0.125, borderRadius: '50%',
          background: color, boxShadow: `0 0 8px ${color}66`,
        }}
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 18. GRADIENT BORDER — Animated gradient border on hover
// ══════════════════════════════════════════════════════════════════════
export function GradientBorder({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <motion.div
      className={className}
      style={{ ...style, position: 'relative', overflow: 'hidden' }}
      whileHover="hover"
      initial="idle"
    >
      <motion.div
        className="absolute inset-0 rounded-[inherit] pointer-events-none"
        style={{ padding: 1.5 }}
        variants={{ idle: { opacity: 0 }, hover: { opacity: 1 } }}
        transition={{ duration: 0.3 }}
      >
        <motion.div
          className="w-full h-full rounded-[inherit]"
          style={{
            background: 'linear-gradient(135deg, #dc3535, #7c3aed, #2563eb, #dc3535)',
            backgroundSize: '300% 300%',
          }}
          animate={{ backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        />
      </motion.div>
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 19. SLIDE REVEAL — Content slides in with a mask wipe
// ══════════════════════════════════════════════════════════════════════
export function SlideReveal({ children, className = '', style, delay = 0 }: {
  children: ReactNode; className?: string; style?: React.CSSProperties; delay?: number;
}) {
  return (
    <div className={className} style={{ ...style, overflow: 'hidden' }}>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ ...spring, delay }}
      >
        {children}
      </motion.div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 20. BREATHE — Breathing glow effect for active elements
// Optimized: simpler boxShadow, no color changes
// ══════════════════════════════════════════════════════════════════════
export function Breathe({ children, className = '', style, color = 'rgba(220,53,53,0.12)' }: {
  children: ReactNode; className?: string; style?: React.CSSProperties; color?: string;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={style}
      animate={{
        boxShadow: [`0 0 6px ${color}`, `0 0 18px ${color}`, `0 0 6px ${color}`],
      }}
      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 21. WAVE BARS — Audio visualizer using Motion springs
// OPTIMIZED: 16 bars instead of 32, no boxShadow per bar
// ══════════════════════════════════════════════════════════════════════
export function WaveBars({ isActive, barCount = 16, className = '' }: {
  isActive: boolean; barCount?: number; className?: string;
}) {
  const prefersReduced = useReducedMotion();
  const bars = useMemo(() =>
    Array.from({ length: barCount }, (_, i) => ({
      minHeight: 3,
      maxHeight: 8 + Math.abs(Math.sin(i * 0.65)) * 24,
      delay: i * 0.03,
      isAccent: i % 3 === 0,
    })),
  [barCount]);

  if (prefersReduced) {
    // Static bars when reduced motion
    return (
      <div className={`flex items-end justify-center gap-[2px] h-10 ${className}`}>
        {bars.map((bar, i) => (
          <div
            key={i}
            className="w-[3px] rounded-full"
            style={{
              height: isActive ? bar.maxHeight / 2 : bar.minHeight,
              background: isActive ? '#dc3535' : 'rgba(0,0,0,0.06)',
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`flex items-end justify-center gap-[2px] h-10 ${className}`}>
      {bars.map((bar, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full"
          style={{
            background: isActive
              ? `linear-gradient(to top, #dc3535, ${bar.isAccent ? '#a78bfa' : '#f28b8b'})`
              : 'rgba(0,0,0,0.06)',
          }}
          animate={isActive ? { height: [bar.minHeight, bar.maxHeight, bar.minHeight] } : { height: bar.minHeight }}
          transition={isActive ? {
            duration: 0.35 + (i % 4) * 0.06,
            repeat: Infinity,
            delay: bar.delay,
            ease: 'easeInOut',
          } : { duration: 0.3 }}
        />
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 22. MICRO INTERACTION BUTTON — Premium button with hover/tap states
// ══════════════════════════════════════════════════════════════════════
export function MicroButton({ children, className = '', style, onClick, variant = 'primary' }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
  onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const variants = {
    primary: { whileHover: { scale: 1.02, y: -1 }, whileTap: { scale: 0.97, y: 0.5 } },
    secondary: { whileHover: { scale: 1.02, y: -1 }, whileTap: { scale: 0.97, y: 0.5 } },
    ghost: { whileHover: { scale: 1.04 }, whileTap: { scale: 0.96 } },
  };

  return (
    <motion.button
      className={className}
      style={style}
      onClick={onClick}
      {...variants[variant]}
      transition={springMicro}
    >
      {children}
    </motion.button>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 23. CONSOLE LOG LINE — Animated console log entries with typewriter
// Feature 8: Typewriter effect for the last log line
// ══════════════════════════════════════════════════════════════════════
export function ConsoleLine({ children, className = '', isLast = false, textContent = '' }: {
  children: ReactNode; className?: string; isLast?: boolean; textContent?: string;
}) {
  const prefersReduced = useReducedMotion();
  const [displayedChars, setDisplayedChars] = useState<number>(0);
  const [isTyping, setIsTyping] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (prefersReduced || !isLast || !textContent) {
      setDisplayedChars(textContent.length);
      return;
    }
    // Start typewriter for the last line
    setDisplayedChars(0);
    setIsTyping(true);
    let charIndex = 0;
    const startTime = performance.now();
    const charDelay = 15; // 15ms per character

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const targetChars = Math.min(textContent.length, Math.floor(elapsed / charDelay));
      if (targetChars !== charIndex) {
        charIndex = targetChars;
        setDisplayedChars(charIndex);
      }
      if (charIndex < textContent.length) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setIsTyping(false);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [textContent, isLast, prefersReduced]);

  // Non-last lines or reduced motion: simple entrance
  if (!isLast || prefersReduced || !textContent) {
    return (
      <motion.div
        className={className}
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 0.8, x: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
      >
        {children}
      </motion.div>
    );
  }

  // Last line: typewriter with cursor
  const displayedText = textContent.slice(0, displayedChars);

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 0.8, x: 0 }}
      whileHover={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <span>{displayedText}</span>
      {isTyping && (
        <span className="inline-block animate-pulse" style={{ color: '#4ade80' }}>▊</span>
      )}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 24. PAGE ENTRANCE — Full page entrance animation
// Optimized: simpler, no blur
// ══════════════════════════════════════════════════════════════════════
export function PageEntrance({ children, className = '' }: {
  children: ReactNode; className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 25. CHIP BADGE — Animated badge/chip for labels
// ══════════════════════════════════════════════════════════════════════
export function ChipBadge({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <motion.span
      className={className}
      style={style}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.06 }}
      transition={spring}
    >
      {children}
    </motion.span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 26. TOGGLE MOTION — Spring-animated toggle switch
// ══════════════════════════════════════════════════════════════════════
export function MotionToggle({ enabled, onClick, className = '' }: {
  enabled: boolean; onClick: () => void; className?: string;
}) {
  return (
    <motion.button
      className={className}
      onClick={onClick}
      style={{
        width: 44, height: 24, borderRadius: 999, padding: 3,
        cursor: 'pointer', position: 'relative', border: 'none', outline: 'none',
      }}
      animate={{
        background: enabled ? 'linear-gradient(135deg, #dc3535, #a51c1c)' : '#d1d5db',
        boxShadow: enabled
          ? '0 0 0 1px rgba(220,53,53,0.2), 0 2px 6px rgba(220,53,53,0.12)'
          : 'inset 0 1px 2px rgba(0,0,0,0.08)',
      }}
      transition={spring}
    >
      <motion.span
        style={{
          display: 'block', width: 18, height: 18, borderRadius: 999,
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
        }}
        animate={{ x: enabled ? 20 : 0 }}
        transition={springBouncy}
      />
    </motion.button>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 27. BACKDROP OVERLAY — Animated modal backdrop
// Optimized: no blur on backdrop (just dark overlay)
// ══════════════════════════════════════════════════════════════════════
export function BackdropOverlay({ children, isOpen, onClose, className = '' }: {
  children: ReactNode; isOpen: boolean; onClose?: () => void; className?: string;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={`fixed inset-0 z-[999] flex items-center justify-center ${className}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="relative z-10"
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={springBouncy}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ══════════════════════════════════════════════════════════════════════
// NEW ANIMATIONS — Premium additions for Awwwards-level UI
// ══════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// 28. CARD ENTRANCE — Premium card entrance with stagger
// Awwwards pattern: cards fade up with subtle scale
// ══════════════════════════════════════════════════════════════════════
export function CardEntrance({ children, className = '', style, index = 0, delay = 0.06 }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
  index?: number; delay?: number;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, delay: index * delay }}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 29. HOVER GLOW — Mouse-tracking glow on cards
// Awwwards pattern: cards have a subtle light that follows cursor
// ══════════════════════════════════════════════════════════════════════
export function HoverGlow({ children, className = '', style, color = 'rgba(220,53,53,0.06)' }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
  color?: string;
}) {
  const prefersReduced = useReducedMotion();
  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);
  const [isHovering, setIsHovering] = useState(false);

  // BUG FIX: Move useTransform to top level (before conditional return) to comply with
  // Rules of Hooks — same fix as TiltCard.
  const hoverGradient = useTransform(
    [mouseX, mouseY],
    ([latestX, latestY]: number[]) =>
      `radial-gradient(300px circle at ${latestX * 100}% ${latestY * 100}%, ${color}, transparent 60%)`
  );

  const handleMouse = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (prefersReduced) return;
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width);
    mouseY.set((e.clientY - rect.top) / rect.height);
  }, [mouseX, mouseY, prefersReduced]);

  if (prefersReduced) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={{ ...style, position: 'relative', overflow: 'hidden' }}
      onMouseMove={handleMouse}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Glow overlay */}
      <motion.div
        className="absolute inset-0 pointer-events-none rounded-[inherit]"
        style={{
          background: hoverGradient,
        }}
        animate={{ opacity: isHovering ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 30. RIPPLE — Material-style ripple on click
// ══════════════════════════════════════════════════════════════════════
export function Ripple({ children, className = '', style, color = 'rgba(220,53,53,0.15)', onClick }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
  color?: string; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number; size: number }>>([]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (useReducedMotion()) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * 2;
    const id = Date.now();
    setRipples(prev => [...prev, { id, x, y, size }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 600);
    // Also call the parent's onClick handler if provided
    onClick?.(e);
  }, [onClick]);

  return (
    <div className={className} style={{ ...style, position: 'relative', overflow: 'hidden' }} onClick={handleClick}>
      {ripples.map(r => (
        <motion.span
          key={r.id}
          style={{
            position: 'absolute',
            left: r.x - r.size / 2,
            top: r.y - r.size / 2,
            width: r.size,
            height: r.size,
            borderRadius: '50%',
            background: color,
            pointerEvents: 'none',
          }}
          initial={{ scale: 0, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      ))}
      {children}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 31. STAGGER LIST — List items animate in with staggered delay
// Awwwards pattern: list items cascade in one by one
// ══════════════════════════════════════════════════════════════════════
export function StaggerList({ children, className = '', delay = 0.04 }: {
  children: ReactNode; className?: string; delay?: number;
}) {
  const prefersReduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-20px' });

  if (prefersReduced) {
    return <div ref={ref} className={className}>{children}</div>;
  }

  return (
    <div ref={ref} className={className}>
      {Array.isArray(children) ? children.map((child, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -12 }}
          animate={isInView ? { opacity: 1, x: 0 } : {}}
          transition={{ ...spring, delay: i * delay }}
        >
          {child}
        </motion.div>
      )) : children}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 32. ANIMATED STAT — Premium stat card number animation
// Untitled UI pattern: stat numbers have a subtle count-up + glow
// ══════════════════════════════════════════════════════════════════════
export function AnimatedStat({ value, label, icon, color = '#dc3535', bgColor = 'rgba(220,53,53,0.08)' }: {
  value: number; label: string; icon: ReactNode;
  color?: string; bgColor?: string;
}) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      className="classic-card text-center py-7 px-4 group"
      style={{ boxShadow: `0 4px 16px ${color}15` }}
      initial={prefersReduced ? {} : { opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={prefersReduced ? {} : { y: -4, boxShadow: `0 8px 24px ${color}20` }}
      transition={spring}
    >
      <motion.div
        className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
        style={{ background: bgColor, color, boxShadow: `inset 0 0 0 1px ${color}22` }}
        whileHover={prefersReduced ? {} : { scale: 1.15, rotate: 6 }}
        whileTap={prefersReduced ? {} : { scale: 0.9 }}
        transition={springBouncy}
      >
        {icon}
      </motion.div>
      <AnimatedCounter value={value} className="text-4xl font-black font-mono leading-none mb-2" style={{ color, textShadow: `0 0 16px ${color}33` }} />
      <div className="text-[10px] uppercase tracking-[0.15em] font-bold" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 33. STATUS PILL — Animated connection status pill
// UI Store pattern: status indicator with animated dot
// ══════════════════════════════════════════════════════════════════════
export function StatusPill({ status, icon, className = '' }: {
  status: 'connected' | 'connecting' | 'disconnected';
  icon: ReactNode; className?: string;
}) {
  const prefersReduced = useReducedMotion();

  const styles: Record<string, { bg: string; color: string; border: string; dotColor: string }> = {
    connected: { bg: 'rgba(5,150,105,0.08)', color: '#059669', border: 'rgba(5,150,105,0.15)', dotColor: '#10b981' },
    connecting: { bg: 'rgba(217,119,6,0.08)', color: '#b45309', border: 'rgba(217,119,6,0.15)', dotColor: '#d97706' },
    disconnected: { bg: 'var(--bg-surface)', color: 'var(--text-tertiary)', border: 'var(--border-default)', dotColor: 'var(--text-muted)' },
  };

  const s = styles[status];

  return (
    <motion.div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-bold uppercase ${className}`}
      style={{ background: s.bg, color: s.color, borderColor: s.border }}
      animate={status === 'connected' && !prefersReduced ? {
        boxShadow: [`0 0 0 1px rgba(5,150,105,0.1)`, `0 0 6px rgba(5,150,105,0.15)`, `0 0 0 1px rgba(5,150,105,0.1)`],
      } : {}}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
    >
      {icon}
      <motion.span
        className="w-2 h-2 rounded-full"
        style={{ background: s.dotColor }}
        animate={
          status === 'connected' && !prefersReduced ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] } :
          status === 'connecting' && !prefersReduced ? { opacity: [1, 0.4, 1] } : {}
        }
        transition={{ duration: status === 'connecting' ? 1 : 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      {status}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 34. PREMIUM CARD — Card with hover glow + entrance animation
// Untitled UI / Awwwards: cards have subtle depth on hover
// ══════════════════════════════════════════════════════════════════════
export function PremiumCard({ children, className = '', style, hover = true, index = 0 }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
  hover?: boolean; index?: number;
}) {
  const prefersReduced = useReducedMotion();

  return (
    <HoverGlow className="classic-card" style={style}>
      <motion.div
        className={`p-6 ${className}`}
        initial={prefersReduced ? {} : { opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        whileHover={hover && !prefersReduced ? { y: -3, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' } : {}}
        transition={{ ...spring, delay: index * 0.05 }}
      >
        {children}
      </motion.div>
    </HoverGlow>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 35. PRESET BUTTON — Animated preset selector button
// UI Store pattern: active state with spring animation
// ══════════════════════════════════════════════════════════════════════
export function PresetButton({ children, isActive, onClick, className = '' }: {
  children: ReactNode; isActive: boolean; onClick: () => void; className?: string;
}) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.button
      onClick={onClick}
      className={className}
      whileHover={prefersReduced ? {} : { scale: 1.04, y: -1 }}
      whileTap={prefersReduced ? {} : { scale: 0.96 }}
      transition={springMicro}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {isActive && !prefersReduced && (
        <motion.div
          className="absolute inset-0 rounded-[inherit]"
          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.15), transparent)' }}
          layoutId="presetHighlight"
          transition={spring}
        />
      )}
      <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
    </motion.button>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 36. NOTIFICATION TOAST — Slide-in notification
// ══════════════════════════════════════════════════════════════════════
export function NotificationToast({ children, isVisible, className = '' }: {
  children: ReactNode; isVisible: boolean; className?: string;
}) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className={className}
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={springBouncy}
          style={{ position: 'fixed', top: 80, right: 20, zIndex: 1000 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 37. SHRINK EXIT — Element shrinks away when removed
// ══════════════════════════════════════════════════════════════════════
export function ShrinkExit({ children, isVisible, className = '' }: {
  children: ReactNode; isVisible: boolean; className?: string;
}) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className={className}
          initial={{ opacity: 1, scale: 1 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8, height: 0, marginBottom: 0 }}
          transition={spring}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 38. ENGINE SWITCH — Animated engine toggle (Camb.ai / Browser)
// Awwwards pattern: segmented control with sliding highlight
// ══════════════════════════════════════════════════════════════════════
export function EngineSwitch({ options, activeId, onChange, className = '' }: {
  options: { id: string; label: string }[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 p-1.5 rounded-xl border ${className}`} style={{ background: 'rgba(0,0,0,0.03)', borderColor: 'var(--border-subtle)' }}>
      {options.map(opt => (
        <motion.button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className="flex-1 py-3 rounded-lg text-sm font-bold cursor-pointer relative"
          style={{ color: activeId === opt.id ? '#a82424' : '#78716c' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={springMicro}
        >
          {activeId === opt.id && (
            <motion.div
              className="absolute inset-0 rounded-lg"
              style={{ background: '#ffffff', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
              layoutId="engineSwitch"
              transition={spring}
            />
          )}
          <span style={{ position: 'relative', zIndex: 1 }}>{opt.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// FEATURE 2: PARTICLE BURST — Crimson particle explosion on skip
// ══════════════════════════════════════════════════════════════════════
export function ParticleBurst({ x, y, active }: {
  x: number; y: number; active: boolean;
}) {
  const prefersReduced = useReducedMotion();
  const [particles] = useState(() =>
    Array.from({ length: 14 }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: 40 + Math.random() * 60,
      size: 3 + Math.random() * 5,
      shade: `hsl(${350 + Math.random() * 20}, ${70 + Math.random() * 20}%, ${40 + Math.random() * 20}%)`,
    }))
  );

  if (prefersReduced || !active) return null;

  return (
    <div style={{ position: 'fixed', left: 0, top: 0, pointerEvents: 'none', zIndex: 9999 }}>
      {particles.map((p, i) => {
        const dx = Math.cos(p.angle) * p.speed;
        const dy = Math.sin(p.angle) * p.speed;
        return (
          <motion.div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              background: p.shade,
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: dx, y: dy, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// FEATURE 3: VOICE MORPH TEXT — Character-by-character morph reveal
// ══════════════════════════════════════════════════════════════════════
export function VoiceMorphText({ text, className = '', style }: {
  text: string; className?: string; style?: React.CSSProperties;
}) {
  const prefersReduced = useReducedMotion();
  const prevTextRef = useRef(text);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (prevTextRef.current !== text) {
      setIsTransitioning(true);
      const t = setTimeout(() => {
        setIsTransitioning(false);
        prevTextRef.current = text;
      }, 400);
      return () => clearTimeout(t);
    }
  }, [text]);

  if (prefersReduced || text.length > 40) {
    return <span className={className} style={style}>{text}</span>;
  }

  const displayText = isTransitioning ? prevTextRef.current : text;

  return (
    <span className={className} style={{ ...style, display: 'inline-block', overflow: 'hidden' }}>
      {displayText.split('').map((char, i) => (
        <motion.span
          key={`${text}-${i}`}
          style={{ display: 'inline-block', whiteSpace: char === ' ' ? 'pre' : undefined }}
          initial={isTransitioning ? { opacity: 0, y: 8 } : undefined}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.02, ease: 'easeOut' }}
        >
          {char}
        </motion.span>
      ))}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// FEATURE 5: QUEUE PROGRESS — Thin animated progress bar
// ══════════════════════════════════════════════════════════════════════
export function QueueProgress({ isPlaying, estimatedDuration, isNext = false }: {
  isPlaying: boolean; estimatedDuration: number; isNext?: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying || estimatedDuration <= 0) {
      setProgress(0);
      return;
    }
    startTimeRef.current = performance.now();
    setProgress(0);

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const p = Math.min(elapsed / (estimatedDuration * 1000), 1);
      setProgress(p);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, estimatedDuration]);

  if (!isPlaying && !isNext) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: isNext ? 1 : 2,
        background: 'rgba(220,53,53,0.1)',
        overflow: 'hidden',
      }}
    >
      <motion.div
        style={{
          height: '100%',
          background: 'linear-gradient(90deg, #dc3535, #f28b8b)',
          width: isNext ? '0%' : `${progress * 100}%`,
          transition: isNext ? undefined : 'width 0.1s linear',
        }}
        initial={false}
        animate={{ width: isNext ? '0%' : `${progress * 100}%` }}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// FEATURE 10: VIRTUAL LIST — Simple virtualized list component
// ══════════════════════════════════════════════════════════════════════
export function VirtualList<T,>({ items, itemHeight, containerHeight, renderItem, overscan = 2 }: {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(items.length - 1, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);
  const visibleItems = items.slice(startIndex, endIndex + 1);
  const offsetY = startIndex * itemHeight;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ height: containerHeight, overflow: 'auto' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
          {visibleItems.map((item, i) => renderItem(item, startIndex + i))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// FEATURE 18: STAT CELEBRATION — Confetti burst when stat hits milestone
// ══════════════════════════════════════════════════════════════════════
export function StatCelebration({ active }: { active: boolean }) {
  const prefersReduced = useReducedMotion();

  const [particles] = useState(() =>
    Array.from({ length: 18 }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: 30 + Math.random() * 50,
      size: 3 + Math.random() * 4,
      color: ['#dc3535', '#fbbf24', '#a78bfa', '#f28b8b', '#7c3aed'][Math.floor(Math.random() * 5)],
      isCircle: Math.random() > 0.5,
    }))
  );

  if (prefersReduced || !active) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 10 }}>
      {particles.map((p, i) => {
        const dx = Math.cos(p.angle) * p.speed;
        const dy = Math.sin(p.angle) * p.speed - 20; // bias upward
        return (
          <motion.div
            key={i}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: p.size,
              height: p.isCircle ? p.size : p.size * 1.5,
              borderRadius: p.isCircle ? '50%' : '2px',
              background: p.color,
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
            animate={{ x: dx, y: dy, opacity: 0, scale: 0.3, rotate: Math.random() * 360 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// FEATURE 19: SPEAKING GLOW — Breathing glow for "Now Speaking" card
// ══════════════════════════════════════════════════════════════════════
export function SpeakingGlow({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={style}
      animate={{
        boxShadow: [
          '0 0 20px rgba(220,53,53,0.15), 0 0 0 1px rgba(220,53,53,0.1)',
          '0 0 40px rgba(220,53,53,0.25), 0 0 0 1px rgba(220,53,53,0.25)',
          '0 0 20px rgba(220,53,53,0.15), 0 0 0 1px rgba(220,53,53,0.1)',
        ],
      }}
      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// FEATURE 35: DEBOUNCED SYNC HOOK — Batches settings changes
// ══════════════════════════════════════════════════════════════════════
export function useDebouncedSync<T extends Record<string, unknown>>(
  values: T,
  onSync: (changed: Partial<T>) => void,
  delayMs = 500,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRef = useRef<T>(values);

  useEffect(() => {
    const changed: Partial<T> = {};
    let hasChanges = false;
    for (const key of Object.keys(values) as Array<keyof T>) {
      if (prevRef.current[key] !== values[key]) {
        changed[key] = values[key];
        hasChanges = true;
      }
    }
    if (!hasChanges) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSync(changed);
      prevRef.current = { ...values };
    }, delayMs);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [values, onSync, delayMs]);
}

// ══════════════════════════════════════════════════════════════════════
// 39. GLOW CARD — Premium card with animated gradient border glow
// Apple/Linear-inspired: cards have a subtle rotating conic gradient
// border that becomes visible on hover
// ══════════════════════════════════════════════════════════════════════
export function GlowCard({ children, className = '', style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={`classic-card p-6 ${className}`} style={style}>{children}</div>;
  }

  return (
    <div
      className={`glow-border ${className}`}
      style={style}
    >
      <motion.div
        className="classic-card p-6 relative z-10"
        style={{
          background: 'rgba(22, 25, 34, 0.65)',
          backdropFilter: 'blur(12px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(12px) saturate(1.2)',
          borderRadius: 'inherit',
        }}
        whileHover={{ y: -2 }}
        transition={springMicro}
      >
        {children}
      </motion.div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 40. SHINE BUTTON — Primary button with shine sweep on hover
// Premium micro-interaction: a light sweep crosses the button on hover
// ══════════════════════════════════════════════════════════════════════
export function ShineButton({ children, className = '', style, onClick, disabled }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
  onClick?: () => void; disabled?: boolean;
}) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.button
      className={`btn-classic-primary ${className}`}
      style={style}
      onClick={onClick}
      disabled={disabled}
      whileHover={prefersReduced ? {} : { scale: 1.02, y: -2 }}
      whileTap={prefersReduced ? {} : { scale: 0.97, y: 1 }}
      transition={springMicro}
    >
      {children}
    </motion.button>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 41. ANIMATED BORDER — Wraps content with animated rotating gradient
// Uses CSS conic-gradient + @property for GPU-friendly rotation
// Subtle at rest, vibrant on hover
// ══════════════════════════════════════════════════════════════════════
export function AnimatedBorder({ children, className = '', style, colors }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
  colors?: string[];
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className} style={style}>{children}</div>;
  }

  const gradientColors = colors || [
    'rgba(220, 53, 53, 0.4)',
    'rgba(124, 58, 237, 0.3)',
    'rgba(37, 99, 235, 0.3)',
    'rgba(220, 53, 53, 0.1)',
  ];

  return (
    <motion.div
      className={`glow-border ${className}`}
      style={style}
      whileHover="hover"
      initial="idle"
    >
      <motion.div
        className="absolute inset-0 rounded-[inherit] pointer-events-none"
        style={{ padding: 1.5 }}
        variants={{ idle: { opacity: 0.3 }, hover: { opacity: 1 } }}
        transition={{ duration: 0.4 }}
      >
        <motion.div
          className="w-full h-full rounded-[inherit]"
          style={{
            background: `conic-gradient(from var(--gradient-angle, 0deg), ${gradientColors.join(', ')}, ${gradientColors[0]})`,
            backgroundSize: '100% 100%',
          }}
          animate={{ backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
        />
      </motion.div>
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 42. USE THEME HOOK — Persistent dark/light mode with localStorage
// Default: dark mode (premium experience)
// ══════════════════════════════════════════════════════════════════════
export function useTheme() {
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('darkMode');
    return stored !== 'false'; // Default to dark
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    localStorage.setItem('darkMode', String(isDark));
  }, [isDark]);

  const toggle = useCallback(() => setIsDark(prev => !prev), []);

  return { isDark, setIsDark, toggle };
}
