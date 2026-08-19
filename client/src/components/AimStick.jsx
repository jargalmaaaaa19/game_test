import { useEffect, useRef } from 'react';

/** How far the knob travels from the base, in pixels, at full deflection. */
const REACH = 58;

/**
 * A floating aim stick.
 *
 * FLOATING, because a fixed one is always under the wrong thumb: put your
 * finger down anywhere in the pad and the base appears there, left side or
 * right, whichever hand you happen to be using.
 *
 * It also HOLDS. A movement stick springs back when you let go, but this one
 * is an aim — releasing it must not throw the shot away, or the event can only
 * be played with two thumbs at once. The knob stays where it was put, so you
 * can set the aim, let go, and then reach over to the loose button.
 *
 * `onAim` is called with each axis in [-1, 1], +y up, and is called OUTSIDE
 * React state on purpose: this fires every pointermove, and re-rendering a
 * target and a scoreboard at that rate is not something to spend on a reticle.
 */
export default function AimStick({ onAim, disabled }) {
  const padRef = useRef(null);
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const aimRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const pad = padRef.current;
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!pad || !base || !knob) return undefined;

    let pointer = null;
    let originX = 0;
    let originY = 0;

    const paint = () => {
      const { x, y } = aimRef.current;
      base.style.left = `${originX}px`;
      base.style.top = `${originY}px`;
      knob.style.transform = `translate(calc(-50% + ${x * REACH}px), calc(-50% + ${-y * REACH}px))`;
    };

    const put = (e) => {
      const rect = pad.getBoundingClientRect();
      const dx = e.clientX - rect.left - originX;
      const dy = e.clientY - rect.top - originY;
      const len = Math.hypot(dx, dy) || 1;
      const scale = Math.min(1, REACH / len);
      // Screen y grows downward; the aim's does not.
      aimRef.current = { x: (dx * scale) / REACH, y: -(dy * scale) / REACH };
      paint();
      onAim(aimRef.current);
    };

    const onDown = (e) => {
      if (disabled || e.target.closest('[data-loose]')) return;
      const rect = pad.getBoundingClientRect();
      pointer = e.pointerId;
      originX = e.clientX - rect.left;
      originY = e.clientY - rect.top;
      base.dataset.live = '1';
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {
        /* uncaptured is still usable */
      }
      put(e);
      e.preventDefault();
    };

    const onMove = (e) => {
      if (pointer !== e.pointerId) return;
      put(e);
    };

    const onUp = (e) => {
      if (pointer !== e.pointerId) return;
      pointer = null;
      base.dataset.live = '0'; // dimmed, but the knob keeps the aim
    };

    pad.addEventListener('pointerdown', onDown);
    pad.addEventListener('pointermove', onMove);
    pad.addEventListener('pointerup', onUp);
    pad.addEventListener('pointercancel', onUp);
    return () => {
      pad.removeEventListener('pointerdown', onDown);
      pad.removeEventListener('pointermove', onMove);
      pad.removeEventListener('pointerup', onUp);
      pad.removeEventListener('pointercancel', onUp);
    };
  }, [onAim, disabled]);

  return (
    <div ref={padRef} className="absolute inset-0 touch-none">
      <div
        ref={baseRef}
        data-live="0"
        style={{ left: '50%', top: '50%' }}
        className="pointer-events-none absolute h-[132px] w-[132px] -translate-x-1/2 -translate-y-1/2
                   rounded-full border-2 transition-opacity duration-150
                   data-[live='1']:border-white/45 data-[live='1']:bg-white/10 data-[live='1']:opacity-100
                   data-[live='0']:border-white/20 data-[live='0']:bg-white/5 data-[live='0']:opacity-60"
      >
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" />
        <div
          ref={knobRef}
          style={{ transform: 'translate(-50%, -50%)' }}
          className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full border-2 border-white/70 bg-white/25"
        />
      </div>
    </div>
  );
}
