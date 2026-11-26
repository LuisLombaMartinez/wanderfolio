import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gsap, useGSAP } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/utils";
import {
  clampPoint,
  getBounds,
  pickPosition,
  readSafeInsets,
  type Box,
  type Point,
} from "@/lib/dodge";

export interface Origin {
  x: number;
  y: number;
}

interface InvitationProps {
  leaving: boolean;
  onYes: (origin: Origin) => void;
}

const DODGE_MESSAGES = [
  "¿Seguro?",
  "Uy…",
  "Casi lo pillas",
  "Piénsatelo bien…",
  "Ese botón está roto",
  "Vale, ya me rindo 😄",
];
const TRIGGER_RADIUS = 90;
const DEBOUNCE_MS = 150;
const SCALE_STEP = 0.26;
const MAX_SCALE = 2.6;
const MARGIN = 16;

function boxOf(r: DOMRect, pad = 0): Box {
  return {
    x: r.left - pad,
    y: r.top - pad,
    w: r.width + pad * 2,
    h: r.height + pad * 2,
  };
}

export function Invitation({ leaving, onYes }: InvitationProps) {
  const root = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);

  const [dodges, setDodges] = useState(0);
  const [reserve, setReserve] = useState(0);
  const [slot, setSlot] = useState<{ w: number; h: number } | null>(null);

  const dodgesRef = useRef(0);
  const leavingRef = useRef(leaving);
  const detached = useRef(false);
  const pos = useRef<Point>({ x: 0, y: 0 });
  const lastDodge = useRef(0);
  const dodgeRef = useRef<
    ((pointer: Point | null, force?: boolean) => void) | null
  >(null);

  useEffect(() => {
    leavingRef.current = leaving;
  }, [leaving]);

  useEffect(() => {
    yesRef.current?.focus({ preventScroll: true });
  }, []);

  /** Largest scale "Sí" may reach without breaking the layout. */
  const capScale = useCallback(() => {
    const yes = yesRef.current;
    if (!yes) return 1;
    const maxW = Math.min(window.innerWidth * 0.86, 520);
    const maxH = window.innerHeight * 0.28;
    return Math.max(
      1,
      Math.min(MAX_SCALE, maxW / yes.offsetWidth, maxH / yes.offsetHeight),
    );
  }, []);

  const scaleFor = useCallback(
    (n: number) => Math.min(1 + SCALE_STEP * n, capScale()),
    [capScale],
  );

  /** Horizontal shift that centres "Sí" in its row once "No" has left. */
  const centerShift = useCallback(() => {
    const yes = yesRef.current;
    const row = rowRef.current;
    if (!yes || !row) return 0;
    return row.clientWidth / 2 - (yes.offsetLeft + yes.offsetWidth / 2);
  }, []);

  // Reserve vertical room for the fully grown "Sí" so nothing jumps or leaves the viewport.
  useEffect(() => {
    const update = () => {
      const yes = yesRef.current;
      if (!yes) return;
      const h = yes.offsetHeight * capScale();
      setReserve(Math.ceil(h + 2 * MARGIN));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [capScale]);

  // Pointer proximity (desktop), touch/pointer down and resize refit.
  useGSAP(
    (_, ctxSafe) => {
      const no = noRef.current;
      if (!no || !ctxSafe) return;
      const dodge = ctxSafe((pointer: Point | null, force = false) => {
        const no = noRef.current;
        const yes = yesRef.current;
        const row = rowRef.current;
        if (!no || !yes || !row || leavingRef.current) return;
        const now = performance.now();
        if (!force && now - lastDodge.current < DEBOUNCE_MS) return;
        lastDodge.current = now;

        const reduced = prefersReducedMotion();
        const n = dodgesRef.current + 1;
        dodgesRef.current = n;

        if (!detached.current) {
          const r = no.getBoundingClientRect();
          setSlot({ w: r.width, h: r.height });
          no.style.position = "fixed";
          no.style.left = "0px";
          no.style.top = "0px";
          gsap.set(no, { x: r.left, y: r.top });
          pos.current = { x: r.left, y: r.top };
          detached.current = true;
        }

        // Where "Sí" will be once it has moved to centre and grown.
        const nextScale = scaleFor(n);
        const yesRect = yes.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const cx = rowRect.left + rowRect.width / 2;
        const cy = yesRect.top + yesRect.height / 2;
        const w = yes.offsetWidth * nextScale;
        const h = yes.offsetHeight * nextScale;
        const obstacles: Box[] = [{ x: cx - w / 2, y: cy - h / 2, w, h }];
        if (questionRef.current)
          obstacles.push(boxOf(questionRef.current.getBoundingClientRect(), 8));

        const size = { w: no.offsetWidth, h: no.offsetHeight };
        const bounds = getBounds(size, MARGIN, readSafeInsets());
        const next = pickPosition({
          bounds,
          size,
          current: pos.current,
          pointer,
          obstacles,
        });
        pos.current = next;

        setDodges(n);

        if (reduced) {
          gsap.set(no, { x: next.x, y: next.y, rotation: 0 });
          gsap.set(yes, { x: centerShift(), scale: nextScale });
          return;
        }

        const sign = Math.random() < 0.5 ? -1 : 1;
        gsap.killTweensOf(no);
        gsap
          .timeline()
          .to(
            no,
            { x: next.x, y: next.y, duration: 0.35, ease: "back.out(1.6)" },
            0,
          )
          .to(
            no,
            {
              rotation: sign * 6,
              scaleX: 1.1,
              scaleY: 0.92,
              duration: 0.15,
              yoyo: true,
              repeat: 1,
            },
            0,
          );
        gsap.to(yes, {
          x: centerShift(),
          scale: nextScale,
          duration: 0.3,
          ease: "back.out(1.7)",
        });
      });
      dodgeRef.current = dodge;
      const onMove = ctxSafe((e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        const r = no.getBoundingClientRect();
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        if (Math.hypot(dx, dy) < TRIGGER_RADIUS)
          dodge({ x: e.clientX, y: e.clientY });
      });
      const onDown = ctxSafe((e: PointerEvent) => {
        e.preventDefault();
        dodge({ x: e.clientX, y: e.clientY });
      });
      const onTouch = (e: TouchEvent) => e.preventDefault();
      const onResize = ctxSafe(() => {
        const yes = yesRef.current;
        if (yes && dodgesRef.current > 0) {
          gsap.set(yes, {
            x: centerShift(),
            scale: scaleFor(dodgesRef.current),
          });
        }
        if (!detached.current) return;
        const size = { w: no.offsetWidth, h: no.offsetHeight };
        pos.current = clampPoint(
          pos.current,
          getBounds(size, MARGIN, readSafeInsets()),
        );
        gsap.set(no, { x: pos.current.x, y: pos.current.y });
      });
      window.addEventListener("pointermove", onMove);
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
      no.addEventListener("pointerdown", onDown);
      no.addEventListener("touchstart", onTouch, { passive: false });
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
        no.removeEventListener("pointerdown", onDown);
        no.removeEventListener("touchstart", onTouch);
      };
    },
    { scope: root, dependencies: [scaleFor, centerShift] },
  );

  // After the label changes, keep "No" fully visible.
  useEffect(() => {
    const no = noRef.current;
    if (!no || !detached.current) return;
    const size = { w: no.offsetWidth, h: no.offsetHeight };
    const target = pos.current;
    const clamped = clampPoint(
      target,
      getBounds(size, MARGIN, readSafeInsets()),
    );
    if (clamped.x === target.x && clamped.y === target.y) return;
    pos.current = clamped;
    // A running dodge tween would overwrite a plain set, so retarget it.
    gsap.killTweensOf(no, "x,y");
    if (prefersReducedMotion()) gsap.set(no, { x: clamped.x, y: clamped.y });
    else
      gsap.to(no, {
        x: clamped.x,
        y: clamped.y,
        duration: 0.25,
        ease: "power2.out",
      });
  }, [dodges]);

  // Heartbeat glow behind "Sí" (off with reduced motion) and the press beat.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          glowRef.current,
          { scale: 1, opacity: 0.5 },
          {
            scale: 1.18,
            opacity: 0,
            duration: 1.5,
            ease: "power1.out",
            repeat: -1,
          },
        );
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  useGSAP(
    () => {
      if (!leaving || prefersReducedMotion()) return;
      const yes = yesRef.current;
      if (!yes) return;
      const current = Number(gsap.getProperty(yes, "scale"));
      gsap.to(yes, {
        scale: current * 1.12,
        duration: 0.15,
        yoyo: true,
        repeat: 1,
        ease: "power1.out",
      });
    },
    { scope: root, dependencies: [leaving] },
  );

  const handleYes = () => {
    const r = yesRef.current?.getBoundingClientRect();
    if (!r) return;
    onYes({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };

  const label =
    dodges === 0 ? "No" : DODGE_MESSAGES[(dodges - 1) % DODGE_MESSAGES.length];
  const glow = Math.min(dodges / 7, 1);

  return (
    <section
      ref={root}
      className="relative flex h-dvh flex-col items-center justify-center overflow-hidden px-5 text-center"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <Decor />

      <div
        className={`relative z-10 flex w-full max-w-2xl flex-col items-center gap-5 transition-opacity duration-200 ${leaving ? "opacity-0" : "opacity-100"}`}
      >
        <p className="font-script text-3xl text-primary" aria-hidden="true">
          para ti
        </p>
        <h1
          ref={questionRef}
          className="font-serif text-[clamp(2rem,8vw,3.5rem)] font-bold leading-[1.1] text-balance"
        >
          ¿Quieres venirte conmigo de viaje?
        </h1>
      </div>

      <div
        ref={rowRef}
        style={reserve ? { minHeight: reserve } : undefined}
        className="relative z-20 mt-6 flex w-full max-w-md items-center justify-center gap-3"
      >
        <Button
          ref={yesRef}
          variant="yes"
          onClick={handleYes}
          style={{
            transformOrigin: "50% 50%",
            boxShadow: `0 10px ${30 + glow * 30}px -8px rgb(190 24 93 / ${0.25 + glow * 0.3})`,
          }}
          className="relative isolate"
        >
          <span
            ref={glowRef}
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-full bg-primary"
            style={{ opacity: 0 }}
          />
          <Heart
            className="size-5 fill-current"
            strokeWidth={2}
            aria-hidden="true"
          />
          Sí
        </Button>

        <div
          style={slot ? { width: slot.w, height: slot.h } : undefined}
          className="relative"
        >
          <Button
            ref={noRef}
            variant="no"
            aria-label={dodges === 0 ? "No" : `No. ${label}`}
            onClick={(e) => e.preventDefault()}
            onFocus={() => dodgeRef.current?.(null, true)}
            className={`z-40 touch-none ${leaving ? "opacity-0 transition-opacity duration-200" : ""}`}
          >
            {label}
          </Button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {dodges > 0 ? label : ""}
      </p>
    </section>
  );
}

function Decor() {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.utils.toArray<HTMLElement>("[data-float]").forEach((el, i) => {
          gsap.to(el, {
            y: -18 - i * 4,
            rotation: i % 2 === 0 ? 8 : -8,
            duration: 3 + i * 0.6,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
          });
        });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  const items = [
    {
      Icon: Heart,
      pos: "left-[8%] top-[14%]",
      cls: "size-8 text-primary/20 fill-current",
    },
    { Icon: Waves, pos: "right-[10%] top-[22%]", cls: "size-10 text-ocean/25" },
    {
      Icon: Heart,
      pos: "right-[18%] bottom-[16%]",
      cls: "size-10 text-accent/30 fill-current",
    },
    {
      Icon: Waves,
      pos: "left-[12%] bottom-[20%]",
      cls: "size-9 text-ocean/25",
    },
    {
      Icon: Heart,
      pos: "left-[46%] top-[6%]",
      cls: "size-6 text-primary/15 fill-current",
    },
  ];
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      {items.map(({ Icon, pos, cls }, i) => (
        <span key={i} data-float className={`absolute ${pos}`}>
          <Icon className={cls} strokeWidth={1.75} />
        </span>
      ))}
    </div>
  );
}
