// clear/in-context.jsx — interactions in-page: selection popup,
// split renarration view, collapsed pill states for all 3 directions.

/* ═══════════════════════════════════════════════════════════
   SELECTION POPUP — a small glass card that appears above a
   user's text selection. Offers quick renarrate + quick feedback.
═══════════════════════════════════════════════════════════ */
function SelectionPopup({ x = 240, y = 240 }) {
  return (
    <div className="clear-surface" style={{ position: 'absolute', left: x, top: y, width: 320 }}>
      {/* Pointer triangle */}
      <div style={{
        position: 'absolute',
        bottom: -7, left: 40,
        width: 14, height: 14,
        background: 'var(--glass-bg-strong)',
        backdropFilter: 'blur(24px)',
        transform: 'rotate(45deg)',
        borderRight: '1px solid var(--glass-border)',
        borderBottom: '1px solid var(--glass-border)',
      }}/>
      <div className="clear-glass clear-glass--strong" style={{ padding: 12, borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em' }}>RENARRATE SELECTION · 47 words</span>
          <span style={{ flex: 1 }}/>
          <span className="clear-chip clear-chip--accent" style={{ height: 18, padding: '0 8px', fontSize: 10 }}>educator lens</span>
        </div>
        <div className="clear-read" style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink)', marginBottom: 10, padding: '0 2px' }}>
          The credit window is a buffer of pending records. As they're acknowledged, capacity returns to the producer. When it hits zero, the partition pauses.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="clear-btn clear-btn--xs clear-btn--ghost"><Icon.check style={{ color: 'var(--pos)' }}/>Good</button>
          <button className="clear-btn clear-btn--xs clear-btn--ghost" style={{ color: 'var(--muted-2)' }}>Off</button>
          <span style={{ flex: 1 }}/>
          <button className="clear-btn clear-btn--xs" style={{ color: 'var(--muted)' }}>Try again</button>
          <button className="clear-btn clear-btn--xs clear-btn--primary"><Icon.plus/>Pin</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SPLIT RENARRATION VIEW — when the user clicks "Renarrate
   this page", the page reflows to its left half and the
   renarrated version slides in on the right.
═══════════════════════════════════════════════════════════ */
function SplitRenarration() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {/* LEFT — original page */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <FakePage tone="article"/>
        {/* Dim overlay to show original is "secondary" */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.04)', pointerEvents: 'none' }}/>
      </div>

      {/* RIGHT — renarrated panel */}
      <div className="clear-surface" style={{
        background: 'var(--paper)',
        borderLeft: '1px solid var(--hairline)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        position: 'relative',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 22px',
          borderBottom: '1px solid var(--hairline-soft)',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'color-mix(in oklch, var(--paper-2) 60%, transparent)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.02em' }}>Clear</span>
              <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>RENARRATED · 18 SEC</span>
            </div>
            <div className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
              ARGUMENT-FIRST · SKIM · EDUCATOR
            </div>
          </div>
          <span style={{ flex: 1 }}/>
          <button className="clear-btn clear-btn--xs clear-btn--ghost">Original</button>
          <button className="clear-btn clear-btn--xs clear-btn--ghost">Translate</button>
          <button className="clear-btn clear-btn--xs"><Icon.close/></button>
        </div>

        {/* TOC / wayfinder */}
        <div style={{ padding: '12px 22px 10px', borderBottom: '1px solid var(--hairline-soft)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="clear-chip clear-chip--accent">① Core argument</span>
          <span className="clear-chip">② What changed</span>
          <span className="clear-chip">③ Skeptics' case</span>
          <span className="clear-chip">④ Where evidence is thin</span>
        </div>

        {/* Body */}
        <div className="clear-read" style={{ padding: '22px 28px 80px', overflow: 'auto', flex: 1, fontSize: 16, lineHeight: 1.65, color: 'var(--ink)' }}>
          <Eyebrow style={{ marginBottom: 8 }}>① Core argument</Eyebrow>
          <p style={{ marginTop: 0, marginBottom: 16, fontSize: 18, lineHeight: 1.5, color: 'var(--ink)' }}>
            Europe's grid has become resilient by accident — through small, unglamorous retrofits, not strategic resilience programs. The article argues this resilience is real but unproven against the next demand curve.
          </p>
          <p style={{ marginBottom: 16, color: 'var(--ink-2)' }}>
            On June 14, a near-failure was averted in Frankfurt. Operators in Brussels and Madrid had been quietly redirecting power for forty minutes before the spike hit. Consumers saw nothing.
          </p>
          <div style={{
            margin: '14px 0',
            padding: '10px 14px',
            background: 'color-mix(in oklch, var(--accent) 7%, transparent)',
            borderLeft: '2px solid var(--accent)',
            borderRadius: '0 8px 8px 0',
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--accent-ink)',
          }}>
            <span className="clear-mono" style={{ fontSize: 10, letterSpacing: '0.08em', display: 'block', marginBottom: 4, opacity: 0.8 }}>WHY THIS MATTERS · for your class</span>
            This is the article's central claim. If you only have time for one section, this is it.
          </div>
          <Eyebrow style={{ margin: '24px 0 8px' }}>② What changed quietly</Eyebrow>
          <p style={{ marginBottom: 16, color: 'var(--ink-2)' }}>
            Better transformer sensors, automated reclosers on rural lines, and weather-aware forecasting. Most retrofits predate the energy crisis — they were funded as cost reductions, not resilience plays. The author's framing reorganizes these into a story.
          </p>
          <Eyebrow style={{ margin: '24px 0 8px' }}>③ Skeptics' case</Eyebrow>
          <p style={{ marginBottom: 6, color: 'var(--ink-2)' }}>
            Two passages (paragraphs 3 and 7) carry the entire counter-argument. Both lean on unnamed internal sources at the operators.
          </p>
        </div>

        {/* Footer rail */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: '12px 22px',
          background: 'color-mix(in oklch, var(--paper) 88%, transparent)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--hairline-soft)',
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>3 OF 4 SECTIONS · 4 MIN READ REMAINING</span>
          <span style={{ flex: 1 }}/>
          <button className="clear-btn clear-btn--xs clear-btn--ghost">Save thread</button>
          <button className="clear-btn clear-btn--xs clear-btn--ghost">Ask follow-up</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   COLLAPSED PILLS — the resting state for each direction
═══════════════════════════════════════════════════════════ */
function CollapsedPills() {
  return (
    <div className="clear-surface" style={{ display: 'flex', flexDirection: 'column', gap: 28, padding: 32, alignItems: 'flex-start' }}>
      {/* Wafer collapsed */}
      <div>
        <Eyebrow style={{ marginBottom: 8 }}>① Wafer · collapsed</Eyebrow>
        <div className="clear-glass clear-glass--strong" style={{ height: 40, padding: '0 6px 0 12px', display: 'inline-flex', alignItems: 'center', gap: 10, borderRadius: 999, minWidth: 240 }}>
          <Grip/>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Clear</span>
          <span style={{ width: 1, height: 12, background: 'var(--hairline)' }}/>
          <span style={{ fontSize: 12, color: 'var(--muted-2)' }}><Icon.dot style={{ color: 'var(--accent)', verticalAlign: 1 }}/> grasp argument</span>
          <button className="clear-btn clear-btn--xs clear-btn--accent" style={{ height: 28, borderRadius: 999 }}>Renarrate</button>
        </div>
      </div>

      {/* Document collapsed → folded tab */}
      <div>
        <Eyebrow style={{ marginBottom: 8 }}>② Document · folded</Eyebrow>
        <div className="clear-glass" style={{ width: 200, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, borderRadius: 12 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'var(--ink)', color: 'var(--paper)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
          }}>C</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>3 insights ready</div>
            <div className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>TAP TO EXPAND</div>
          </div>
          <Icon.chevron style={{ color: 'var(--muted)', transform: 'rotate(-90deg)' }}/>
        </div>
      </div>

      {/* Compass collapsed → single orb */}
      <div>
        <Eyebrow style={{ marginBottom: 8 }}>③ Compass · resting orb</Eyebrow>
        <div className="clear-glass clear-glass--strong" style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: '1px dashed var(--hairline)' }}/>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'var(--ink)', color: 'var(--paper)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600,
          }}>C</div>
          <div style={{
            position: 'absolute', top: -4, right: -4,
            width: 18, height: 18, borderRadius: 999,
            background: 'var(--accent)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)',
            border: '2px solid var(--paper)',
          }}>3</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SelectionPopup, SplitRenarration, CollapsedPills });
