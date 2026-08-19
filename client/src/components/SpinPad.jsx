import { useEffect, useRef } from 'react';

/** How much of the pad's short side the circle takes up. */
const RING_FRACTION = 0.34;
// How far past the painted edge a finger may stray before it counts as leaving
// the circle. A ring with no give at all fouls on the pixel, which reads as the
// control breaking rather than the player over-reaching.
const FOUL_TOLERANCE = 1.08;
// A revolution is only counted while the finger is out near the rim. Circling
// tightly around the centre point sweeps 2π for almost no thumb travel, and
// without this the whole event is won by vibrating a fingertip on one spot.
const MIN_TURN_RADIUS = 0.45;

/**
 * The throwing circle, as a control.
 *
 * The player puts a finger inside the ring and DRAWS CIRCLES. Every completed
 * revolution is one `onTurn()` — the sim times the gaps between them and winds
 * the athlete accordingly, so this component reports events and never a speed.
 * That split is deliberate: a velocity computed here would be a number the
 * client asserts about itself, and the server would have to either trust it or
 * throw it away.
 *
 * Leaving the ring calls `onFoul()`. This is the wager the whole event is built
 * on — circling faster is worth more and is harder to keep inside the paint —
 * so the boundary has to be VISIBLE and it has to be honest: it is drawn where
 * it is measured, and the knob keeps rendering past the edge on the frame it
 * fouls so the player sees exactly where they went.
 *
 * Nothing here is React state. This fires every pointermove, and re-rendering a
 * stadium at that rate is not something to spend on a fingertip.
 */
export default function SpinPad({ onTurn, onRelease, onFoul, green, disabled }) {
  const padRef = useRef(null);
  const ringRef = useRef(null);
  const knobRef = useRef(null);
  // The callbacks are read out of a ref inside the listeners, so a re-render
  // that hands down new ones does not tear the gesture down mid-spin.
  const cbRef = useRef({ onTurn, onRelease, onFoul });
  cbRef.current = { onTurn, onRelease, onFoul };

  useEffect(() => {
    const pad = padRef.current;
    const ring = ringRef.current;
    const knob = knobRef.current;
    if (!pad || !ring || !knob) return undefined;

    let pointer = null;
    let cx = 0;
    let cy = 0;
    let radius = 0;
    let lastAngle = 0;
    let swept = 0; // radians accumulated since the last counted revolution
    let fouled = false;

    const measure = () => {
      const rect = pad.getBoundingClientRect();
      cx = rect.width / 2;
      cy = rect.height / 2;
      radius = Math.min(rect.width, rect.height) * RING_FRACTION;
      ring.style.width = `${radius * 2}px`;
      ring.style.height = `${radius * 2}px`;
      return rect;
    };

    const place = (x, y, live) => {
      knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      knob.dataset.live = live ? '1' : '0';
    };

    const end = () => {
      pointer = null;
      swept = 0;
      place(0, 0, false);
    };

    const onDown = (e) => {
      if (disabled || pointer !== null) return;
      const rect = measure();
      const x = e.clientX - rect.left - cx;
      const y = e.clientY - rect.top - cy;
      // Starting outside the circle is not a foul, it is a miss: the athlete
      // has not picked the hammer up yet.
      if (Math.hypot(x, y) > radius) return;

      pointer = e.pointerId;
      fouled = false;
      swept = 0;
      lastAngle = Math.atan2(y, x);
      place(x, y, true);
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {
        /* uncaptured is still usable */
      }
      e.preventDefault();
    };

    const onMove = (e) => {
      if (pointer !== e.pointerId || fouled) return;
      const rect = pad.getBoundingClientRect();
      const x = e.clientX - rect.left - cx;
      const y = e.clientY - rect.top - cy;
      const reach = Math.hypot(x, y);
      place(x, y, true);

      if (reach > radius * FOUL_TOLERANCE) {
        // Drawn where it happened, then handed over. The knob is left sitting
        // outside the paint for the frame the foul is announced on.
        fouled = true;
        cbRef.current.onFoul?.();
        end();
        return;
      }

      const angle = Math.atan2(y, x);
      let step = angle - lastAngle;
      // The atan2 seam: a step of more than half a turn between two frames is
      // the wrap, not a thumb that crossed the pad in 16ms.
      if (step > Math.PI) step -= 2 * Math.PI;
      if (step < -Math.PI) step += 2 * Math.PI;
      lastAngle = angle;

      // Only real travel counts, and only in one direction at a time — a
      // finger scrubbed back and forth would otherwise bank |sweep| forever.
      if (reach < radius * MIN_TURN_RADIUS) return;
      swept += step;

      while (Math.abs(swept) >= 2 * Math.PI) {
        swept -= Math.sign(swept) * 2 * Math.PI;
        cbRef.current.onTurn?.();
      }
    };

    const onUp = (e) => {
      if (pointer !== e.pointerId) return;
      const released = !fouled;
      end();
      if (released) cbRef.current.onRelease?.();
    };

    // `pointercancel` is the phone taking the finger away — a notification
    // sliding in, a palm on the bezel. That is not a release the player chose,
    // so it ends the gesture without throwing.
    const onCancel = (e) => {
      if (pointer !== e.pointerId) return;
      end();
    };

    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(pad);

    pad.addEventListener('pointerdown', onDown);
    pad.addEventListener('pointermove', onMove);
    pad.addEventListener('pointerup', onUp);
    pad.addEventListener('pointercancel', onCancel);
    return () => {
      ro?.disconnect();
      pad.removeEventListener('pointerdown', onDown);
      pad.removeEventListener('pointermove', onMove);
      pad.removeEventListener('pointerup', onUp);
      pad.removeEventListener('pointercancel', onCancel);
    };
  }, [disabled]);

  return (
    <div ref={padRef} className="absolute inset-0 touch-none">
      <div
        ref={ringRef}
        data-green={green ? '1' : '0'}
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                   rounded-full border-[3px] border-dashed transition-colors duration-100
                   data-[green='1']:border-solid data-[green='1']:border-emerald-300
                   data-[green='1']:bg-emerald-300/15 data-[green='1']:shadow-[0_0_28px_rgba(52,211,153,0.45)]
                   data-[green='0']:border-white/35 data-[green='0']:bg-white/5"
      >
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" />
        <div
          ref={knobRef}
          data-live="0"
          style={{ transform: 'translate(-50%, -50%)' }}
          className="absolute left-1/2 top-1/2 h-11 w-11 rounded-full border-2 border-white/80 bg-white/30
                     transition-opacity duration-150 data-[live='0']:opacity-0 data-[live='1']:opacity-100"
        />
      </div>
    </div>
  );
}
