// clear/shared.jsx — shared primitives: FakePage, icons, helpers.

const { useState, useRef, useEffect } = React;

/* ─────────────────────────────────────────────────────────
   FakePage — a believable webpage that sits BEHIND overlays.
   Renders a fake news article so the backdrop-blur of the
   glass overlays has something interesting to refract.
───────────────────────────────────────────────────────── */
function FakePage({ tone = "article", scrollY = 0 }) {
  const styles = {
    root: {
      position: 'absolute', inset: 0, overflow: 'hidden',
      background: tone === 'article'
        ? 'linear-gradient(180deg, #faf9f6 0%, #f3f1eb 100%)'
        : tone === 'docs'
        ? '#fafbfc'
        : '#f6f7fa',
      fontFamily: 'Georgia, "Iowan Old Style", serif',
      color: '#2a2a28',
    },
    nav: {
      position: 'sticky', top: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 40px',
      borderBottom: '1px solid rgba(0,0,0,0.08)',
      background: 'rgba(255,255,255,0.7)',
      backdropFilter: 'blur(12px)',
      fontFamily: '"Inter Tight", sans-serif',
      fontSize: 13,
      letterSpacing: '-0.01em',
    },
    article: {
      maxWidth: 720,
      margin: '0 auto',
      padding: '48px 48px 80px',
      transform: `translateY(${-scrollY}px)`,
    },
  };

  if (tone === 'docs') {
    return (
      <div style={styles.root}>
        <div style={styles.nav}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: '#111' }}>kepler.dev</span>
            <span style={{ color: '#6b7280' }}>Docs</span>
            <span style={{ color: '#6b7280' }}>API</span>
            <span style={{ color: '#6b7280' }}>Community</span>
          </div>
          <div style={{ color: '#9ca3af', fontSize: 12 }}>v2.4 · Search…</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 0 }}>
          <aside style={{ padding: '28px 24px', borderRight: '1px solid rgba(0,0,0,0.06)', fontFamily: '"Inter Tight", sans-serif', fontSize: 13, color: '#374151' }}>
            <div style={{ fontWeight: 600, marginBottom: 12, color: '#111', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Getting started</div>
            {['Installation', 'Quickstart', 'Configuration', 'Authentication'].map((s, i) => (
              <div key={s} style={{ padding: '6px 10px', borderRadius: 6, marginBottom: 2, color: i === 1 ? '#111' : '#6b7280', background: i === 1 ? 'rgba(0,0,0,0.05)' : 'transparent', fontWeight: i === 1 ? 500 : 400 }}>{s}</div>
            ))}
            <div style={{ fontWeight: 600, margin: '20px 0 12px', color: '#111', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Core concepts</div>
            {['Streams', 'Topics', 'Partitions', 'Consumer groups', 'Producers', 'Retention policies'].map((s) => (
              <div key={s} style={{ padding: '6px 10px', borderRadius: 6, marginBottom: 2, color: '#6b7280' }}>{s}</div>
            ))}
          </aside>
          <main style={{ padding: '40px 64px', fontFamily: '"Inter Tight", sans-serif', fontSize: 15, color: '#1f2937', lineHeight: 1.7 }}>
            <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}>core / streams</div>
            <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 16px', color: '#0a0a0a' }}>Stream processing with backpressure</h1>
            <p style={{ color: '#4b5563', fontSize: 16, lineHeight: 1.65, marginBottom: 28 }}>Kepler streams use a credit-based flow control system to ensure that producers never overwhelm consumers. The runtime negotiates throughput per partition based on observed consumer lag.</p>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '32px 0 12px', color: '#0a0a0a' }}>How credits work</h2>
            <p style={{ marginBottom: 16 }}>Each consumer maintains a window of outstanding credits. As records are acknowledged, credits are returned to the producer side via the underlying transport layer. When credits reach zero, the producer applies <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>SUSPEND</code> to that partition until the consumer signals readiness.</p>
            <div style={{ background: '#0f172a', color: '#e2e8f0', borderRadius: 8, padding: '16px 20px', fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>
              <div style={{ color: '#94a3b8' }}>// configure backpressure</div>
              <div><span style={{ color: '#c084fc' }}>const</span> stream = kepler.<span style={{ color: '#7dd3fc' }}>stream</span>({'{'}</div>
              <div>  topic: <span style={{ color: '#fde68a' }}>"events.user"</span>,</div>
              <div>  credits: <span style={{ color: '#fde68a' }}>256</span>,</div>
              <div>  onLag: (ms) =&gt; ms &gt; <span style={{ color: '#fde68a' }}>500</span> ? <span style={{ color: '#fde68a' }}>"throttle"</span> : <span style={{ color: '#fde68a' }}>"resume"</span>,</div>
              <div>{'}'});</div>
            </div>
            <p style={{ marginBottom: 16 }}>Tuning the initial credit window is a tradeoff between latency and memory. A larger window reduces round-trips but increases the consumer's buffer footprint. Most production workloads converge somewhere between 64 and 512 outstanding records.</p>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '32px 0 12px', color: '#0a0a0a' }}>When to override</h2>
            <p style={{ marginBottom: 16 }}>The default policy is conservative — it favors stability over throughput. If your topology has predictable load patterns, you may want to disable adaptive credit issuance and pin the window manually.</p>
            <p style={{ color: '#6b7280', marginBottom: 16 }}>For background on the underlying flow-control protocol, see the <span style={{ textDecoration: 'underline', color: '#4338ca' }}>Transport reference</span>.</p>
          </main>
        </div>
      </div>
    );
  }

  // Default: news article
  return (
    <div style={styles.root}>
      <div style={styles.nav}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 18, color: '#0a0a0a' }}>The Meridian</span>
          <span style={{ color: '#6b7280' }}>Politics</span>
          <span style={{ color: '#6b7280' }}>Science</span>
          <span style={{ color: '#0a0a0a', fontWeight: 500 }}>Climate</span>
          <span style={{ color: '#6b7280' }}>Culture</span>
        </div>
        <div style={{ color: '#9ca3af', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>17 MAY 2026 · TUE</div>
      </div>
      <div style={styles.article}>
        <div style={{ fontFamily: '"Inter Tight", sans-serif', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 12 }}>Climate · Long read · 18 min</div>
        <h1 style={{ fontSize: 42, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em', margin: '0 0 16px', color: '#0a0a0a', fontFamily: 'Georgia, "Iowan Old Style", serif' }}>The grid is bending, not breaking — for now</h1>
        <p style={{ fontSize: 19, lineHeight: 1.5, color: '#374151', margin: '0 0 28px', fontFamily: 'Georgia, serif' }}>A decade of overlapping retrofits has left European transmission operators with more flexibility than anyone expected. Whether it survives the next heatwave depends on a stack of forecasting assumptions almost no one understands.</p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 32, fontFamily: '"Inter Tight", sans-serif', fontSize: 13, color: '#6b7280' }}>
          <div style={{ width: 32, height: 32, borderRadius: 999, background: '#d1d5db' }}></div>
          <div>
            <div style={{ color: '#0a0a0a', fontWeight: 500 }}>Sasha Voren</div>
            <div>Senior climate reporter</div>
          </div>
        </div>
        <p style={{ fontSize: 17, lineHeight: 1.75, color: '#1f2937', marginBottom: 18 }}>By the time the first cooling demand spike reached Frankfurt's load-balancing node on the morning of June 14, the grid had already been quietly redirecting power for nearly forty minutes. Operators in Brussels and Madrid, watching the same upstream signals, made small adjustments that, taken together, prevented what could easily have been a continent-wide brownout.</p>
        <p style={{ fontSize: 17, lineHeight: 1.75, color: '#1f2937', marginBottom: 18 }}>None of it was visible to consumers. That is the point. For most of the past two decades, Europe's electrical infrastructure has been treated as a sclerotic legacy system — too expensive to overhaul, too fragmented to coordinate, too political to touch. The reality on the ground tells a different story: a slow, almost invisible accumulation of marginal improvements that, in aggregate, have produced something close to resilience.</p>
        <p style={{ fontSize: 17, lineHeight: 1.75, color: '#1f2937', marginBottom: 18 }}>Skeptics, including some inside the operators themselves, argue this resilience is illusory. The grid has not been stress-tested at its true limits, and the next decade's demand curve — driven by data centers, heat pumps, and the electrification of road freight — will not look like the last.</p>
        <h2 style={{ fontSize: 26, fontWeight: 700, margin: '36px 0 14px', color: '#0a0a0a', letterSpacing: '-0.01em', fontFamily: 'Georgia, serif' }}>What changed quietly</h2>
        <p style={{ fontSize: 17, lineHeight: 1.75, color: '#1f2937', marginBottom: 18 }}>The retrofits that did the work were largely unglamorous: better sensors on transformers, automated reclosers on rural lines, and a generation of forecasting models that finally took weather seriously. Most of these projects predate the current energy crisis. They were funded as cost-reduction initiatives, not resilience plays.</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Tiny icons — drawn as inline SVG, no emoji.
───────────────────────────────────────────────────────── */
const Icon = {
  arrow: (p) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}><path d="M3 7h8m-3-3 3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  send: (p) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}><path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  sparkle: (p) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}><path d="M7 1.5v3M7 9.5v3M1.5 7h3M9.5 7h3M3.5 3.5l2 2M8.5 8.5l2 2M3.5 10.5l2-2M8.5 5.5l2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  close: (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><path d="m3 3 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  chevron: (p) => <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...p}><path d="m3 4 2 2 2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  dot: (p) => <svg width="6" height="6" viewBox="0 0 6 6" {...p}><circle cx="3" cy="3" r="3" fill="currentColor"/></svg>,
  plus: (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  check: (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><path d="m2.5 6.5 2.5 2.5 4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  book: (p) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}><path d="M2 3h4a2 2 0 0 1 2 2v6a2 2 0 0 0-2-2H2V3ZM12 3H8a2 2 0 0 0-2 2v6a2 2 0 0 1 2-2h4V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  user: (p) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}><circle cx="7" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.3"/><path d="M2.5 12c.6-2.2 2.4-3.2 4.5-3.2s3.9 1 4.5 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  target: (p) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}><circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeWidth="1.3"/><circle cx="7" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.3"/><circle cx="7" cy="7" r="0.6" fill="currentColor"/></svg>,
  layers: (p) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}><path d="M7 2 1.5 5 7 8l5.5-3L7 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M2 9l5 3 5-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  pin: (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><path d="M6 1.5v3.2L4 7h4L6 4.7M6 7v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  minus: (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
};

/* Drag-grip pips (6 dots, 2×3) */
function Grip({ tone = 'muted' }) {
  return (
    <span className="clear-grip" title="Drag">
      <i></i><i></i><i></i><i></i><i></i><i></i>
    </span>
  );
}

/* Eyebrow label */
function Eyebrow({ children, ...rest }) {
  return <div className="clear-eyebrow" {...rest}>{children}</div>;
}

Object.assign(window, { FakePage, Icon, Grip, Eyebrow });
