// clear/pages.jsx — full-page Clear surfaces:
//   · Settings (Tasks, Personas, System Prompt, Research)
//   · Extracted Content viewer
//   · Research Dashboard

/* ═══════════════════════════════════════════════════════════
   SETTINGS PAGE
═══════════════════════════════════════════════════════════ */
function SettingsPage() {
  return (
    <div className="clear-surface" style={{ background: 'var(--paper-2)', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '24px 36px 22px', borderBottom: '1px solid var(--hairline)', background: 'var(--paper)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>C</div>
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Clear</span>
          <span style={{ color: 'var(--muted)', fontSize: 14 }}>· Settings</span>
          <span style={{ flex: 1 }}/>
          <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>SAVED 2 SEC AGO</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['General', 'Tasks', 'Personas', 'System prompt', 'Research'].map((t, i) => (
            <button key={t} className={'clear-btn clear-btn--sm' + (i === 1 ? ' clear-btn--ghost' : '')} style={{ background: i === 1 ? 'color-mix(in oklch, var(--ink) 6%, transparent)' : 'transparent', borderRadius: 8, padding: '6px 12px', fontWeight: i === 1 ? 600 : 500, color: i === 1 ? 'var(--ink)' : 'var(--muted-2)' }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content — two-column: list + active editor */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px 1fr', overflow: 'hidden' }}>
        {/* List rail */}
        <div style={{ borderRight: '1px solid var(--hairline)', overflow: 'auto', background: 'var(--paper)', padding: '20px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Eyebrow>Tasks · 5</Eyebrow>
            <button className="clear-btn clear-btn--xs clear-btn--ghost"><Icon.plus/>New</button>
          </div>
          {[
            { name: 'Simplify',           sub: 'Plain-language rewrite for non-experts', active: true },
            { name: 'Critique',           sub: 'Surface argument + counter + weak evidence' },
            { name: 'Translate to brief', sub: 'Compress to an executive 3-bullet brief' },
            { name: 'Teach',              sub: 'Explanatory, structured for a learner' },
            { name: 'Source check',       sub: 'Quote claims and flag unsourced ones' },
          ].map((t) => (
            <div key={t.name} style={{
              padding: '10px 12px',
              borderRadius: 10,
              marginBottom: 4,
              cursor: 'pointer',
              background: t.active ? 'color-mix(in oklch, var(--ink) 6%, transparent)' : 'transparent',
              border: t.active ? '1px solid var(--hairline)' : '1px solid transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: t.active ? 600 : 500 }}>{t.name}</span>
                {t.active && <span className="clear-chip clear-chip--accent" style={{ height: 16, padding: '0 6px', fontSize: 9 }}>ACTIVE</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.4 }}>{t.sub}</div>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div style={{ overflow: 'auto', padding: '24px 36px' }}>
          <div style={{ maxWidth: 640 }}>
            <Eyebrow style={{ marginBottom: 6 }}>Task</Eyebrow>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Simplify</h2>
              <button className="clear-btn clear-btn--xs" style={{ color: 'var(--muted)' }}>Rename</button>
              <span style={{ flex: 1 }}/>
              <button className="clear-btn clear-btn--xs" style={{ color: 'var(--neg)' }}>Delete</button>
              <button className="clear-btn clear-btn--xs clear-btn--ghost">Duplicate</button>
            </div>

            <div style={{ marginBottom: 22 }}>
              <Eyebrow style={{ marginBottom: 8 }}>Description</Eyebrow>
              <input className="clear-input" defaultValue="Plain-language rewrite for non-experts"/>
            </div>

            <div style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Eyebrow>Instruction prompt</Eyebrow>
                <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>184 / 2000</span>
              </div>
              <div className="clear-mono" style={{
                fontSize: 12.5, lineHeight: 1.65,
                background: 'var(--paper)',
                border: '1px solid var(--hairline)',
                borderRadius: 12,
                padding: 14,
                color: 'var(--ink-2)',
                whiteSpace: 'pre-wrap',
              }}>{`Rewrite the text so a curious non-expert can understand
it on first reading. Replace jargon with concrete words.
Keep the author's logic intact. Don't add new claims.
Aim for ~70% of the original length.`}</div>
            </div>

            <div style={{ marginBottom: 22 }}>
              <Eyebrow style={{ marginBottom: 8 }}>Effective prompt preview</Eyebrow>
              <div style={{
                background: 'color-mix(in oklch, var(--ink) 96%, var(--accent))',
                color: 'var(--paper)',
                borderRadius: 12,
                padding: 16,
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                lineHeight: 1.7,
                position: 'relative',
              }}>
                <span className="clear-mono" style={{ position: 'absolute', top: 10, right: 14, fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em' }}>READ ONLY</span>
                <span style={{ color: 'rgba(255,255,255,0.55)' }}>{'// system'}</span><br/>
                You are Clear, a reading assistant. The reader is acting as a <span style={{ color: 'oklch(0.78 0.15 75)' }}>{'{persona: educator}'}</span>. Their current task is <span style={{ color: 'oklch(0.78 0.15 75)' }}>{'{task: simplify}'}</span>. Apply the task instruction below, then return the rewritten text only…
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
              <button className="clear-btn clear-btn--primary">Save changes</button>
              <button className="clear-btn clear-btn--ghost">Test on current page</button>
              <span style={{ flex: 1 }}/>
              <button className="clear-btn clear-btn--xs" style={{ color: 'var(--muted)' }}>Restore default</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   EXTRACTED CONTENT VIEWER — compact page knowledge with
   structure (vs. the original plain <pre>).
═══════════════════════════════════════════════════════════ */
function ExtractedViewer() {
  const facts = [
    { kind: 'CLAIM',   text: 'Europe\'s grid avoided a continent-wide brownout on June 14 through quiet operator-side redirection.', conf: 0.92 },
    { kind: 'CLAIM',   text: 'Most retrofits predate the energy crisis and were funded as cost reductions.', conf: 0.88 },
    { kind: 'COUNTER', text: 'Skeptics inside the operators argue the resilience is illusory and untested at true peak.', conf: 0.71 },
    { kind: 'FIGURE',  text: 'Forecast demand growth driven by data centers, heat pumps, and electrified freight.', conf: 0.6 },
    { kind: 'QUOTE',   text: '"Operators in Brussels and Madrid, watching the same upstream signals, made small adjustments…"', conf: 1 },
  ];
  return (
    <div className="clear-surface" style={{ background: 'var(--paper-2)', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 32px 14px', borderBottom: '1px solid var(--hairline)', background: 'var(--paper)' }}>
        <Eyebrow>Page knowledge · extracted</Eyebrow>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: '6px 0 4px' }}>
          The grid is bending, not breaking — for now
        </h1>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
          <span>meridian.news / climate</span>
          <span>·</span>
          <span className="clear-mono">18 MIN READ</span>
          <span>·</span>
          <span className="clear-mono">2 318 WORDS</span>
          <span style={{ flex: 1 }}/>
          <button className="clear-btn clear-btn--xs clear-btn--ghost">Re-extract</button>
          <button className="clear-btn clear-btn--xs clear-btn--ghost">Copy JSON</button>
          <button className="clear-btn clear-btn--xs clear-btn--primary">Renarrate</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 32, maxWidth: 1080 }}>
          {/* Main column — structured fact list */}
          <div>
            <Eyebrow style={{ marginBottom: 10 }}>Summary</Eyebrow>
            <p className="clear-read" style={{ fontSize: 15.5, lineHeight: 1.65, color: 'var(--ink)', margin: '0 0 26px' }}>
              A long-form piece arguing that Europe's electrical grid has become quietly resilient through small, unstrategic retrofits — but that the next decade's demand pattern may exceed what's been stress-tested. The author notes that skepticism comes from inside the operators themselves, though the sources for that skepticism are unnamed.
            </p>

            <Eyebrow style={{ marginBottom: 10 }}>Facts &amp; claims · {facts.length}</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--hairline-soft)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--hairline)' }}>
              {facts.map((f, i) => (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: '74px 1fr 60px',
                  gap: 12,
                  padding: '12px 14px',
                  background: 'var(--paper)',
                  alignItems: 'baseline',
                }}>
                  <span className="clear-mono" style={{
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    color: f.kind === 'COUNTER' ? 'var(--warn)' : f.kind === 'CLAIM' ? 'var(--accent-ink)' : 'var(--muted)',
                    fontWeight: 600,
                  }}>{f.kind}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>{f.text}</span>
                  <ConfBar c={f.conf}/>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar — meta */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="clear-glass" style={{ padding: 14, borderRadius: 12, background: 'var(--paper)' }}>
              <Eyebrow style={{ marginBottom: 8 }}>Entities</Eyebrow>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {['Frankfurt', 'Brussels', 'Madrid', 'June 14', 'Sasha Voren', 'data centers', 'heat pumps'].map((e) => (
                  <span key={e} className="clear-chip" style={{ height: 22, fontSize: 11 }}>{e}</span>
                ))}
              </div>
            </div>
            <div style={{ padding: 14, borderRadius: 12, background: 'var(--paper)', border: '1px solid var(--hairline)' }}>
              <Eyebrow style={{ marginBottom: 8 }}>Reading goal match</Eyebrow>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em' }}>84</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>/ 100</span>
              </div>
              <div style={{ height: 4, background: 'var(--paper-3)', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ height: '100%', width: '84%', background: 'var(--accent)' }}/>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted-2)', lineHeight: 1.5 }}>
                Strong on argument + counter. Weak on quantitative evidence — the demand-curve figures are referenced but never sourced.
              </div>
            </div>
            <div style={{ padding: 14, borderRadius: 12, background: 'var(--paper)', border: '1px solid var(--hairline)' }}>
              <Eyebrow style={{ marginBottom: 8 }}>Extraction</Eyebrow>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: 'var(--muted-2)' }}>
                <Row k="Model" v="gpt-text-4o · vision-4o"/>
                <Row k="Tokens" v="3 218 in · 612 out"/>
                <Row k="Latency" v="2.1 s"/>
                <Row k="Screenshots" v="2 (fallback)"/>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{k.toUpperCase()}</span>
      <span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function ConfBar({ c }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifySelf: 'end' }}>
      <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{Math.round(c * 100)}</span>
      <div style={{ width: 28, height: 3, background: 'var(--paper-3)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${c * 100}%`, background: c > 0.85 ? 'var(--pos)' : c > 0.65 ? 'var(--accent)' : 'var(--warn)' }}/>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   RESEARCH DASHBOARD
═══════════════════════════════════════════════════════════ */
function ResearchDashboard() {
  return (
    <div className="clear-surface" style={{ background: 'var(--paper-2)', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 36px 14px', background: 'var(--paper)', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--ink)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13 }}>C</div>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>Clear / Research</span>
          <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>STUDY · P0001 → P0024</span>
          <span style={{ flex: 1 }}/>
          <input className="clear-input" style={{ width: 240, fontSize: 12, padding: '6px 10px' }} placeholder="Search logs, users, sessions…"/>
          <button className="clear-btn clear-btn--sm clear-btn--ghost">Refresh</button>
          <button className="clear-btn clear-btn--sm clear-btn--primary">Export</button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { name: 'Overview', active: true },
            { name: 'Conversations' },
            { name: 'Experiments' },
            { name: 'Feedback' },
            { name: 'Preferences' },
            { name: 'Logs' },
          ].map((t) => (
            <button key={t.name} className="clear-btn clear-btn--sm" style={{ background: t.active ? 'color-mix(in oklch, var(--ink) 6%, transparent)' : 'transparent', borderRadius: 8, fontWeight: t.active ? 600 : 500, color: t.active ? 'var(--ink)' : 'var(--muted-2)' }}>{t.name}</button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ padding: '20px 36px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { k: 'Participants', v: '24', delta: '+3 this week', good: true },
          { k: 'Renarration runs', v: '1 412', delta: '+187', good: true },
          { k: 'Median feedback', v: 'Good', delta: '76% positive', good: true },
          { k: 'Refinement events', v: '38', delta: '−12 vs. prev wk', good: true },
        ].map((s) => (
          <div key={s.k} style={{ background: 'var(--paper)', border: '1px solid var(--hairline)', borderRadius: 12, padding: 14 }}>
            <Eyebrow style={{ marginBottom: 8 }}>{s.k}</Eyebrow>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em' }}>{s.v}</span>
              <span className="clear-mono" style={{ fontSize: 10, color: s.good ? 'var(--pos)' : 'var(--muted)' }}>↑</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{s.delta}</div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 36px 36px', display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        {/* Activity timeline */}
        <div style={{ background: 'var(--paper)', border: '1px solid var(--hairline)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Eyebrow>Renarration activity · last 7d</Eyebrow>
            <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>UTC</span>
          </div>
          <ActivityChart/>

          <Eyebrow style={{ margin: '24px 0 10px' }}>Recent runs</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 90px 110px 60px', gap: 10, fontSize: 11.5, color: 'var(--muted)', padding: '4px 0 8px', borderBottom: '1px solid var(--hairline-soft)' }}>
            <span className="clear-mono">USER</span>
            <span className="clear-mono">PAGE</span>
            <span className="clear-mono">TASK</span>
            <span className="clear-mono">LATENCY</span>
            <span className="clear-mono" style={{ textAlign: 'right' }}>FB</span>
          </div>
          {[
            { u: 'P0014', p: 'nature.com / climate-grid',     t: 'critique',   l: '2.4 s', f: '👍' },
            { u: 'P0007', p: 'kepler.dev / docs/streams',     t: 'simplify',   l: '1.8 s', f: '👍' },
            { u: 'P0021', p: 'meridian.news / energy-report', t: 'brief',      l: '3.1 s', f: '·' },
            { u: 'P0003', p: 'nyt / science / quantum',       t: 'teach',      l: '2.2 s', f: '👎' },
            { u: 'P0014', p: 'arxiv / 2503.14132',            t: 'critique',   l: '4.7 s', f: '👍' },
          ].map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 90px 110px 60px', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--hairline-soft)', alignItems: 'center', fontSize: 12.5 }}>
              <span className="clear-mono" style={{ color: 'var(--muted-2)' }}>{r.u}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.p}</span>
              <span className="clear-chip clear-chip--outline" style={{ height: 20, padding: '0 8px', fontSize: 10.5, justifySelf: 'start' }}>{r.t}</span>
              <span className="clear-mono" style={{ color: 'var(--muted-2)', fontSize: 11.5 }}>{r.l}</span>
              <span style={{ textAlign: 'right' }}>{r.f}</span>
            </div>
          ))}
        </div>

        {/* Side column: feedback breakdown + per-task */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--paper)', border: '1px solid var(--hairline)', borderRadius: 14, padding: 18 }}>
            <Eyebrow style={{ marginBottom: 14 }}>Feedback distribution</Eyebrow>
            <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ flex: 76, background: 'var(--pos)' }}/>
              <div style={{ flex: 14, background: 'var(--muted)' }}/>
              <div style={{ flex: 10, background: 'var(--neg)' }}/>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              {[
                { k: 'Good',     v: 76, c: 'var(--pos)' },
                { k: 'Neutral',  v: 14, c: 'var(--muted)' },
                { k: 'Off',      v: 10, c: 'var(--neg)' },
              ].map((r) => (
                <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: r.c }}/>
                  <span style={{ flex: 1, color: 'var(--ink-2)' }}>{r.k}</span>
                  <span className="clear-mono" style={{ color: 'var(--muted)' }}>{r.v}%</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: 'var(--paper)', border: '1px solid var(--hairline)', borderRadius: 14, padding: 18 }}>
            <Eyebrow style={{ marginBottom: 14 }}>By task</Eyebrow>
            {[
              { k: 'simplify',  count: 482, pos: 0.84 },
              { k: 'critique',  count: 310, pos: 0.71 },
              { k: 'brief',     count: 264, pos: 0.78 },
              { k: 'teach',     count: 218, pos: 0.69 },
              { k: 'source',    count: 138, pos: 0.82 },
            ].map((r) => (
              <div key={r.k} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 40px', gap: 10, padding: '8px 0', alignItems: 'center', borderBottom: '1px solid var(--hairline-soft)' }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{r.k}</span>
                <div style={{ height: 5, background: 'var(--paper-3)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${r.pos * 100}%`, background: 'var(--accent)' }}/>
                </div>
                <span className="clear-mono" style={{ fontSize: 11, color: 'var(--muted-2)', textAlign: 'right' }}>{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Mini bar chart for the dashboard */
function ActivityChart() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const data = [
    [120, 28, 18], [180, 32, 14], [156, 40, 22], [210, 36, 28],
    [240, 30, 22], [98, 14, 6], [72, 10, 4],
  ];
  const max = 320;
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', height: 120, padding: '0 4px' }}>
      {data.map((d, i) => {
        const total = d[0] + d[1] + d[2];
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted-2)' }}>{total}</span>
            <div style={{ width: '100%', height: 90, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ height: `${d[2] / max * 90}px`, background: 'var(--neg)' }}/>
              <div style={{ height: `${d[1] / max * 90}px`, background: 'var(--muted)' }}/>
              <div style={{ height: `${d[0] / max * 90}px`, background: 'var(--accent)' }}/>
            </div>
            <span className="clear-mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{days[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { SettingsPage, ExtractedViewer, ResearchDashboard });
