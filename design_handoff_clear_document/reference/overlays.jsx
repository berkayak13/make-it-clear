// clear/overlays.jsx — Three floating overlay directions
// All sit on top of a FakePage. Each one represents a distinct
// layout philosophy for the same product.

const { useState: useStateO } = React;

/* ═══════════════════════════════════════════════════════════
   DIRECTION 1 — WAFER
   A horizontal pill that drops a compact panel.
   Minimal chrome. Gets out of the way.
═══════════════════════════════════════════════════════════ */
function Wafer({ x = 540, y = 24, expanded = true }) {
  return (
    <div className="clear-surface" style={{ position: 'absolute', left: x, top: y, width: 420 }}>
      {/* Pill bar (always visible) */}
      <div className="clear-glass clear-glass--strong" style={{
        height: 44,
        borderRadius: 999,
        padding: '0 6px 0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        position: 'relative',
        zIndex: 2,
      }}>
        <Grip />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.02em' }}>Clear</span>
          <span style={{ width: 1, height: 12, background: 'var(--hairline)', display: 'inline-block' }}></span>
          <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>
            <span style={{ color: 'var(--accent-ink)' }}>●</span> Grasp the core argument
          </span>
        </div>
        <div style={{ flex: 1 }}></div>
        <button className="clear-btn clear-btn--xs" style={{ background: 'transparent', color: 'var(--muted)' }}><Icon.minus/></button>
        <button className="clear-btn clear-btn--accent clear-btn--sm" style={{ height: 32, borderRadius: 999, padding: '0 12px' }}>
          Renarrate
        </button>
      </div>

      {expanded && (
        <div className="clear-glass" style={{
          marginTop: 8,
          padding: 14,
          borderRadius: 16,
        }}>
          {/* Conversation strip */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '78%', background: 'var(--ink)', color: 'var(--paper)', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', fontSize: 13, lineHeight: 1.45 }}>
              I'm prepping for a class on grid resilience. Skim, then highlight what's contested.
            </div>
            <div style={{ alignSelf: 'flex-start', maxWidth: '90%', fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>
              Got it. I'll surface the argument, the counter-case from skeptics, and flag where the article's evidence is thin. Set this as your goal?
            </div>
          </div>

          {/* Goal preview chip */}
          <div style={{
            padding: 10,
            background: 'color-mix(in oklch, var(--accent) 7%, transparent)',
            border: '1px solid color-mix(in oklch, var(--accent) 25%, transparent)',
            borderRadius: 10,
            marginBottom: 12,
          }}>
            <Eyebrow style={{ color: 'var(--accent-ink)', marginBottom: 6 }}>Proposed goal</Eyebrow>
            <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 8 }}>
              Skim a long climate piece for its central argument, then surface where skeptics push back and where evidence is weakest.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="clear-chip clear-chip--outline clear-mono" style={{ fontSize: 10 }}>DEPTH · skim</span>
              <span className="clear-chip clear-chip--outline clear-mono" style={{ fontSize: 10 }}>FOCUS · argument + counter</span>
              <span className="clear-chip clear-chip--outline clear-mono" style={{ fontSize: 10 }}>STYLE · academic</span>
            </div>
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="clear-input" placeholder="Refine the goal, or just ask…" style={{ flex: 1 }}/>
            <button className="clear-btn clear-btn--ghost" style={{ padding: '9px 10px' }}><Icon.send/></button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DIRECTION 2 — DOCUMENT
   Vertical reader-companion. Always shows: goal, page knowledge,
   conversation. Right-anchored sidebar feel, but free-floating.
═══════════════════════════════════════════════════════════ */
function DocumentOverlay({ x = 820, y = 80 }) {
  return (
    <div className="clear-surface clear-glass" style={{
      position: 'absolute',
      left: x, top: y,
      width: 372,
      borderRadius: 18,
      padding: 0,
      overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--hairline-soft)' }}>
        <Grip/>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.02em' }}>Clear</span>
          <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>READING · meridian.news</span>
        </div>
        <button className="clear-btn clear-btn--xs" style={{ background: 'transparent', color: 'var(--muted)' }}><Icon.pin/></button>
        <button className="clear-btn clear-btn--xs" style={{ background: 'transparent', color: 'var(--muted)' }}><Icon.close/></button>
      </div>

      {/* Reading goal block */}
      <div style={{ padding: '14px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Eyebrow>Reading goal</Eyebrow>
          <button className="clear-btn clear-btn--xs" style={{ color: 'var(--muted)', background: 'transparent' }}>Edit</button>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 10, color: 'var(--ink)' }}>
          Grasp the core argument and surface where it's contested.
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--muted-2)' }}>
          <span><span style={{ color: 'var(--muted)' }}>Depth</span> · skim</span>
          <span><span style={{ color: 'var(--muted)' }}>Style</span> · academic</span>
          <span><span style={{ color: 'var(--muted)' }}>As</span> · educator</span>
        </div>
      </div>

      <hr className="clear-hr"/>

      {/* Page knowledge */}
      <div style={{ padding: '14px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Eyebrow>Page knowledge</Eyebrow>
          <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
            <Icon.check style={{ color: 'var(--pos)', verticalAlign: -2, marginRight: 4 }}/>EXTRACTED 12s
          </span>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', marginBottom: 10 }}>
          A long-read arguing that Europe's grid has quietly become resilient through unglamorous retrofits, but the next demand curve (data centers, heat pumps, road freight) may exceed what's been tested.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { k: '01', v: 'Central thesis: resilience exists, but is unproven at true peak' },
            { k: '02', v: 'Skeptics inside operators dispute the framing' },
            { k: '03', v: 'Retrofits were cost initiatives, not resilience plays' },
          ].map((kp) => (
            <div key={kp.k} style={{ display: 'flex', gap: 10, padding: '4px 0', alignItems: 'baseline' }}>
              <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)', minWidth: 18 }}>{kp.k}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>{kp.v}</span>
            </div>
          ))}
        </div>
      </div>

      <hr className="clear-hr"/>

      {/* Conversation */}
      <div style={{ padding: '14px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Eyebrow>Conversation</Eyebrow>
        <div style={{ alignSelf: 'flex-end', maxWidth: '88%', background: 'var(--ink)', color: 'var(--paper)', padding: '7px 11px', borderRadius: '12px 12px 4px 12px', fontSize: 12.5, lineHeight: 1.45 }}>
          Where does the skeptics' counter-argument actually appear?
        </div>
        <div style={{ alignSelf: 'flex-start', maxWidth: '92%', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
          Two passages — paragraphs 3 and 7. Both rely on the same internal-operator sources, which the article doesn't name. I can stitch them together and flag the source weakness.
        </div>
      </div>

      {/* Input + primary action */}
      <div style={{ padding: '10px 12px 12px', background: 'color-mix(in oklch, var(--paper-2) 60%, transparent)', borderTop: '1px solid var(--hairline-soft)' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input className="clear-input" placeholder="Ask about this page…" style={{ flex: 1, fontSize: 12.5, padding: '8px 10px' }}/>
          <button className="clear-btn clear-btn--ghost" style={{ padding: '7px 10px' }}><Icon.send/></button>
        </div>
        <button className="clear-btn clear-btn--primary" style={{ width: '100%', justifyContent: 'center' }}>
          <Icon.sparkle/>Renarrate this page
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DIRECTION 3 — COMPASS
   Radial dial. The current "reading lens" sits at the center;
   the three inputs (Goal · Persona · Task) orbit around it.
   Tap one to open its panel.
═══════════════════════════════════════════════════════════ */
function Compass({ x = 600, y = 90 }) {
  const size = 280;
  return (
    <div className="clear-surface" style={{ position: 'absolute', left: x, top: y }}>
      {/* Orbit disc */}
      <div style={{ position: 'relative', width: size, height: size }}>
        {/* Outer glass disc */}
        <div className="clear-glass" style={{
          position: 'absolute', inset: 0,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 50% 35%, color-mix(in oklch, var(--paper) 88%, transparent) 0%, color-mix(in oklch, var(--paper) 60%, transparent) 70%)',
        }}/>
        {/* SVG dial */}
        <svg width={size} height={size} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <circle cx={size/2} cy={size/2} r={size/2 - 14} fill="none" stroke="var(--hairline)" strokeWidth="1" strokeDasharray="2 4"/>
          <circle cx={size/2} cy={size/2} r={size/2 - 50} fill="none" stroke="var(--hairline)" strokeWidth="1"/>
          {/* Pointer arc highlighting "Goal" */}
          <path d={describeArc(size/2, size/2, size/2 - 14, -110, -70)} stroke="var(--accent)" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        </svg>

        {/* Center — current lens */}
        <div style={{ position: 'absolute', inset: '50% 50% auto auto', transform: 'translate(50%, -50%)', textAlign: 'center', width: 140 }}>
          <Eyebrow style={{ marginBottom: 6 }}>Current lens</Eyebrow>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, color: 'var(--ink)', marginBottom: 4 }}>
            Argument-first<br/>skim
          </div>
          <div className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.04em' }}>
            EDUCATOR · CRITIQUE
          </div>
        </div>

        {/* Satellite chips */}
        {[
          { angle: -90, label: 'Goal', val: 'core argument', active: true },
          { angle:  30, label: 'Persona', val: 'educator' },
          { angle: 150, label: 'Task', val: 'critique' },
        ].map((s) => {
          const r = size / 2 - 14;
          const cx = size / 2 + r * Math.cos(s.angle * Math.PI / 180);
          const cy = size / 2 + r * Math.sin(s.angle * Math.PI / 180);
          return (
            <div key={s.label} style={{
              position: 'absolute',
              left: cx, top: cy,
              transform: 'translate(-50%, -50%)',
              padding: '6px 10px',
              borderRadius: 999,
              background: s.active ? 'var(--ink)' : 'var(--paper)',
              color: s.active ? 'var(--paper)' : 'var(--ink)',
              border: s.active ? '1px solid var(--ink)' : '1px solid var(--hairline)',
              boxShadow: '0 4px 12px rgba(16,22,36,0.10)',
              fontSize: 11,
              fontWeight: 500,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
              minWidth: 76,
            }}>
              <span className="clear-mono" style={{ fontSize: 9, opacity: 0.7, letterSpacing: '0.06em' }}>{s.label.toUpperCase()}</span>
              <span style={{ whiteSpace: 'nowrap' }}>{s.val}</span>
            </div>
          );
        })}
      </div>

      {/* Input rail under the dial */}
      <div className="clear-glass clear-glass--strong" style={{
        marginTop: -12,
        padding: '10px 12px 10px 14px',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        borderRadius: 999,
        width: size,
        zIndex: 2,
        position: 'relative',
      }}>
        <Grip/>
        <input className="clear-input" placeholder="Ask Clear about this page…" style={{ flex: 1, border: 0, background: 'transparent', padding: '4px 0', fontSize: 13, boxShadow: 'none' }}/>
        <button className="clear-btn clear-btn--accent" style={{ borderRadius: 999, height: 30, padding: '0 12px' }}>
          <Icon.sparkle/>Renarrate
        </button>
      </div>
    </div>
  );
}

/* Helper for the compass arc */
function polarToCartesian(cx, cy, r, angleDeg) {
  const a = (angleDeg) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return ['M', start.x, start.y, 'A', r, r, 0, largeArc, 0, end.x, end.y].join(' ');
}

Object.assign(window, { Wafer, DocumentOverlay, Compass });
