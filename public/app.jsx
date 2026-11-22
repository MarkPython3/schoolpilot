const { useState, useEffect, useRef, useMemo, useCallback } = React;
const Mo = window.Motion || {};
const motion = Mo.motion, AnimatePresence = Mo.AnimatePresence, MotionConfig = Mo.MotionConfig;
const useReducedMotion = Mo.useReducedMotion || (() => false);
const { useScroll, useTransform, useMotionValue, useMotionValueEvent } = Mo; // scroll-driven landing scenes
const spring = { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 };        // default UI: near-critically damped, no distracting bounce
const springBounce = { type: 'spring', stiffness: 420, damping: 26, mass: 0.9 };  // momentum interactions (flick / drag release): a little overshoot
const SheetCtx = React.createContext(null);  // Sheet hands its onClose to the draggable Modal inside it (drag-to-dismiss)
const cx = (...a) => a.filter(Boolean).join(' ');
const de = (n) => (n % 100 >= 20 || (n > 0 && n % 100 === 0) ? 'de ' : ''); // 20 de elevi, 101 elevi, 120 de elevi
const plural = (n, one, many) => `${n} ${n === 1 ? one : de(n) + many}`; // Romanian singular/plural
const DAYS = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mie', 'Joi', 'Vin'];

const HEAT = {
  none:  { bg: '#eef1ea', fg: '#8a948a', ring: 'transparent' },
  calm:  { bg: '#dcefdf', fg: '#0f7c45', ring: '#a9d8bf' },
  light: { bg: '#f3ecc7', fg: '#8a6a12', ring: '#e3d492' },
  busy:  { bg: '#f3e2cf', fg: '#9a5a1e', ring: '#e6bd94' },
  heavy: { bg: '#f2dcd8', fg: '#9e3330', ring: '#e3aaa3' },
};

/* ---------------- API ---------------- */
// Supabase client (created at boot from /api/config) and what to do when the server says 401.
let sb = null;
let onUnauthorized = () => {};
let onMustChangePassword = () => {}; // the admin reset this account's password mid-session
// Demo pass (the stand's QR code): the server signs it, no Supabase session involved
let demoToken = localStorage.getItem('sp-demo') || null;
const setDemo = (t) => { demoToken = t; if (t) localStorage.setItem('sp-demo', t); else localStorage.removeItem('sp-demo'); };
const authHeader = async () => {
  if (demoToken) return { Authorization: `Bearer ${demoToken}` };
  if (!sb) return {};
  const { data } = await sb.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
};
const jfetch = async (url, opts = {}) => {
  const headers = { ...(opts.headers || {}), ...(await authHeader()) };
  const r = await fetch(url, { ...opts, headers }).catch(() => { throw new Error('Nu pot contacta serverul.'); });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) onUnauthorized();
  if (r.status === 403 && d.mustChangePassword) onMustChangePassword();
  if (!r.ok) throw new Error(d.error || 'A apărut o eroare. Încearcă din nou.');
  return d;
};
const API = {
  get: (p) => jfetch(p),
  post: (p, b) => jfetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }),
  patch: (p, b) => jfetch(p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }),
  del: (p) => jfetch(p, { method: 'DELETE' }),
};
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const MONTHS_RO = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const fmtDate = (s) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s || ''); return m ? `${Number(m[2])} ${MONTHS_RO[Number(m[1]) - 1]}` : (s || ''); };
const gradeStyle = (v) => ({ background: v >= 9 ? '#DEF7E6' : v >= 7 ? '#E7FBF7' : v >= 5 ? '#FBF1CF' : '#FBDFDF', color: v >= 9 ? '#0F7C39' : v >= 7 ? '#0B7A72' : v >= 5 ? '#946500' : '#AE1919' });
// [busy, once]: once(fn) ignores repeat calls (double click, Enter + click) while fn's promise is pending
function useBusy() {
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const once = (fn) => (...args) => {
    if (flight.current) return;
    const p = fn(...args);
    if (!p || typeof p.finally !== 'function') return p;
    flight.current = true; setBusy(true);
    return p.finally(() => { flight.current = false; setBusy(false); });
  };
  return [busy, once];
}
const absentaLabel = (n) => (n === 1 ? '1 absență' : `${n} ${de(n)}absențe`);

/* ---------------- Icons ---------------- */
const Ic = ({ size = 20, fill = false, sw = 1.75, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>
);
const Icons = {
  sun: (p) => <Ic {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Ic>,
  grid: (p) => <Ic {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Ic>,
  pulse: (p) => <Ic {...p}><path d="M3 12h4l2 6 4-14 2 8h6" /></Ic>,
  chart: (p) => <Ic {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Ic>,
  check: (p) => <Ic {...p}><path d="M20 6 9 17l-5-5" /></Ic>,
  plus: (p) => <Ic {...p}><path d="M12 5v14M5 12h14" /></Ic>,
  chevR: (p) => <Ic {...p}><path d="m9 18 6-6-6-6" /></Ic>,
  chevL: (p) => <Ic {...p}><path d="m15 18-6-6 6-6" /></Ic>,
  chevD: (p) => <Ic {...p}><path d="m6 9 6 6 6-6" /></Ic>,
  alert: (p) => <Ic {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></Ic>,
  bag: (p) => <Ic {...p}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18M16 10a4 4 0 0 1-8 0" /></Ic>,
  clock: (p) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ic>,
  shield: (p) => <Ic {...p}><path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z" /></Ic>,
  user: (p) => <Ic {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Ic>,
  users: (p) => <Ic {...p}><circle cx="9" cy="8" r="3.4" /><path d="M2.5 21a6.5 6.5 0 0 1 13 0" /><path d="M16 5.5a3.4 3.4 0 0 1 0 6.6M17 21a6.5 6.5 0 0 0-3-5.5" /></Ic>,
  teacher: (p) => <Ic {...p}><path d="M3 7l9-4 9 4-9 4z" /><path d="M7 9v5c0 1.4 2.2 2.6 5 2.6s5-1.2 5-2.6V9" /><path d="M21 7v5" /></Ic>,
  book: (p) => <Ic {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></Ic>,
  building: (p) => <Ic {...p}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></Ic>,
  target: (p) => <Ic {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></Ic>,
  x: (p) => <Ic {...p}><path d="M18 6 6 18M6 6l12 12" /></Ic>,
  minus: (p) => <Ic {...p}><path d="M5 12h14" /></Ic>,
  calendar: (p) => <Ic {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Ic>,
  trash: (p) => <Ic {...p}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Ic>,
  home: (p) => <Ic {...p}><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></Ic>,
  logout: (p) => <Ic {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></Ic>,
  megaphone: (p) => <Ic {...p}><path d="M3 11v2a2 2 0 0 0 2 2h2l10 5V4L7 9H5a2 2 0 0 0-2 2z" /><path d="M20.5 9.5a4 4 0 0 1 0 5M8 15.5V19a2 2 0 0 0 4 0v-1.5" /></Ic>,
  message: (p) => <Ic {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" /></Ic>,
  send: (p) => <Ic {...p}><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" /></Ic>,
  download: (p) => <Ic {...p}><path d="M12 3v12M7 11l5 5 5-5M4 21h16" /></Ic>,
  search: (p) => <Ic {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Ic>,
  info: (p) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Ic>,
  bell: (p) => <Ic {...p}><path d="M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 21a2 2 0 0 0 3.4 0" /></Ic>,
  mic: (p) => <Ic {...p}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" /></Ic>,
  spark: (p) => <Ic {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></Ic>,
  pencil: (p) => <Ic {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Ic>,
  key: (p) => <Ic {...p}><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2 2" /></Ic>,
  copy: (p) => <Ic {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></Ic>,
};

/* ---------------- primitives ---------------- */
function Dot({ hue = '#5E6E6B', size = 10 }) { return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: hue }} />; }
function Pill({ children, tone = 'muted', className }) {
  const t = { muted: 'bg-paper text-muted', brand: 'bg-brand-50 text-brand-600', heavy: 'text-heat-heavy' };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-700', t[tone], className)}>{children}</span>;
}
/* Primary action: moulded green plastic (Dose). Name kept so every call site is unchanged. */
function ShimmerButton({ children, className, icon, ...p }) {
  return (
    <button {...p} className={cx('dose-btn dose-btn--primary inline-flex items-center justify-center gap-2 px-5 py-2.5 font-600 disabled:opacity-50', className)}>
      {icon}{children}
    </button>
  );
}
function FluidTabs({ tabs, active, onChange, id, fill }) {
  return (
    <div className={cx('relative items-center gap-1 rounded-full border border-line bg-white/70 p-1 shadow-pill backdrop-blur', fill ? 'flex w-full sm:inline-flex sm:w-auto' : 'inline-flex')}>
      {tabs.map((t) => { const on = active === t.id; return (
        <button key={t.id} onClick={() => onChange(t.id)} className={cx('relative rounded-full py-2 text-sm font-700 transition-colors', fill ? 'min-w-0 flex-auto px-1 max-sm:text-[13px] sm:flex-none sm:px-4' : 'px-4', on ? 'text-ink' : 'text-muted hover:text-ink')}>
          {on && <motion.span layoutId={`fluid-${id}`} transition={spring} className="absolute inset-0 rounded-full bg-brand-50 ring-1 ring-brand-100" />}
          <span className="relative z-10 inline-flex items-center gap-1.5">{fill ? <span className="hidden sm:inline">{t.icon}</span> : t.icon}{t.label}</span>
        </button>
      ); })}
    </div>
  );
}
function Sheet({ open, onClose, children, labelledBy }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);
  return (
    <AnimatePresence>{open && (
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
        <SheetCtx.Provider value={onClose}>{children}</SheetCtx.Provider>
      </div>
    )}</AnimatePresence>
  );
}
function Modal({ children, wide }) {
  // Apple-style bottom sheet: grab the handle and drag down to dismiss. Motion tracks the finger
  // 1:1, rubber-bands at the top, and on release uses offset+velocity to decide dismiss vs. snap
  // back (§2,3,6,9 of the apple-design skill). Only the handle starts the drag, so inner scrolling
  // never fights it. Desktop (no handle) and reduced-motion fall back to the plain modal.
  const onClose = React.useContext(SheetCtx);
  const reduce = useReducedMotion();
  const controls = Mo.useDragControls ? Mo.useDragControls() : null;
  const draggable = !!(onClose && controls && !reduce);
  return <motion.div
      initial={{ opacity: 0, y: 24, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 80, scale: .98 }} transition={spring}
      drag={draggable ? 'y' : false} dragControls={draggable ? controls : undefined} dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }} dragTransition={springBounce}
      onDragEnd={draggable ? (e, info) => { if (info.offset.y > 120 || info.velocity.y > 550) onClose(); } : undefined}
      className={cx('relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-xl2 bg-white p-6 shadow-lift sm:rounded-xl2', wide ? 'max-w-lg' : 'max-w-md')}>
    <div onPointerDown={draggable ? (e) => controls.start(e) : undefined}
      className={cx('mx-auto mb-4 h-1.5 w-10 rounded-full bg-line sm:hidden', draggable && 'cursor-grab touch-none active:cursor-grabbing')} />
    {children}</motion.div>;
}
/* Toasts (after Watermelon's soft Sonner variants). Call toast.success / .error / .info from anywhere. */
let pushToast = () => {};
const toast = {
  success: (text) => pushToast('success', text),
  error: (text) => pushToast('error', text),
  info: (text) => pushToast('info', text),
};
const toastError = (e) => toast.error(errText(e));
const TOAST_STYLES = {
  success: { icon: Icons.check, tone: 'border-heat-calm/25 bg-heat-calmbg text-heat-calm' },
  error: { icon: Icons.alert, tone: 'border-heat-heavy/25 bg-heat-heavybg text-heat-heavy' },
  info: { icon: Icons.info, tone: 'border-brand-100 bg-brand-50 text-brand-600' },
};
function Toaster() {
  const [items, setItems] = useState([]);
  const nextId = useRef(0);
  const dismiss = (id) => setItems((l) => l.filter((x) => x.id !== id));
  useEffect(() => {
    pushToast = (kind, text) => {
      const id = ++nextId.current;
      setItems((l) => [...l.slice(-2), { id, kind, text }]);
      setTimeout(() => dismiss(id), 3000);
    };
    return () => { pushToast = () => {}; };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-20 z-[70] flex flex-col items-center gap-2 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:items-end">
      <AnimatePresence initial={false}>
        {items.map((t) => { const k = TOAST_STYLES[t.kind]; return (
          <motion.button key={t.id} layout type="button" onClick={() => dismiss(t.id)} role={t.kind === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: 16, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .96 }} transition={spring}
            className={cx('pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-left text-[13.5px] font-600 shadow-lift', k.tone)}>
            <k.icon size={18} className="shrink-0" /><span className="min-w-0 flex-1">{t.text}</span>
          </motion.button>
        ); })}
      </AnimatePresence>
    </div>
  );
}

/* Confirm dialog (after Watermelon's destructive Dialog). `await askConfirm({ title, body, action })` gives true or false. */
let openConfirm = () => Promise.resolve(false);
const askConfirm = (opts) => openConfirm(opts);
function ConfirmHost() {
  const [ask, setAsk] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    openConfirm = (opts) => new Promise((resolve) => setAsk({ ...opts, resolve, returnTo: document.activeElement }));
    return () => { openConfirm = () => Promise.resolve(false); };
  }, []);
  const answer = (yes) => {
    ask.resolve(yes);
    setAsk(null);
    if (ask.returnTo && ask.returnTo.focus) ask.returnTo.focus();
  };
  useEffect(() => {
    if (!ask) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); answer(false); } // don't also close a sheet underneath
      if (e.key === 'Tab') {
        const buttons = box.current.querySelectorAll('button');
        const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); buttons[0].focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey, true); document.body.style.overflow = before; };
  }, [ask]);
  return (
    <AnimatePresence>{ask && (
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="alertdialog" aria-modal="true" aria-labelledby="confirm-t" aria-describedby="confirm-b">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => answer(false)} className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
        <Modal>
          <div ref={box}>
            <span className="grid h-12 w-12 place-items-center rounded-full bg-heat-heavybg text-heat-heavy"><Icons.alert size={22} /></span>
            <h3 id="confirm-t" className="mt-3 font-display text-xl font-700 leading-tight">{ask.title}</h3>
            <p id="confirm-b" className="mt-1.5 text-sm text-muted">{ask.body}</p>
            <div className="mt-5 flex gap-2">
              <button autoFocus onClick={() => answer(false)} className="flex-1 rounded-xl border border-line px-4 py-2.5 font-700 text-muted hover:bg-paper">Renunță</button>
              <button onClick={() => answer(true)} className="flex-1 rounded-xl bg-heat-heavy px-4 py-2.5 font-700 text-white hover:opacity-90">{ask.action}</button>
            </div>
          </div>
        </Modal>
      </div>
    )}</AnimatePresence>
  );
}

/* Searchable select (after Watermelon's Combobox). `inline` opens inside the page flow, for use in scrolling sheets. */
const plainText = (t) => (t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function SearchSelect({ value, onChange, options, placeholder, searchPlaceholder = 'Caută…', empty = 'Niciun rezultat.', label, inline }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const reduceSS = useReducedMotion();
  const root = useRef(null);
  const trigger = useRef(null);
  const needle = plainText(q.trim());
  const shown = options.filter((o) => plainText(o.label).includes(needle));
  const current = options.find((o) => o.value === value);
  const close = () => { setOpen(false); setQ(''); };
  const pick = (o) => { onChange(o.value); close(); trigger.current.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (e) => { if (!root.current.contains(e.target)) close(); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    if (e.key === 'Escape') { e.stopPropagation(); close(); trigger.current.focus(); } // keeps the sheet open
  };
  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-label={label}
        onClick={() => { setActive(0); setOpen((v) => !v); }}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-left text-sm outline-none hover:bg-paper/60 focus:border-brand">
        <span className={cx('min-w-0 truncate', !current && 'text-muted')}>{current ? current.label : placeholder}</span>
        <Icons.chevD size={16} className="shrink-0 text-muted" />
      </button>
      <AnimatePresence>{open && (
        <motion.div initial={reduceSS ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={reduceSS ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }} transition={spring} style={{ transformOrigin: 'top' }}
          className={cx('w-full overflow-hidden rounded-xl border border-line bg-white shadow-lift', inline ? 'mt-1.5' : 'absolute z-30 mt-1.5')}>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Icons.search size={15} className="shrink-0 text-muted" />
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" />
          </div>
          <div role="listbox" className="max-h-56 overflow-y-auto p-1">
            {shown.length === 0 && <p className="p-3 text-center text-[13px] text-muted">{empty}</p>}
            {shown.map((o, i) => (
              <button key={o.value} type="button" role="option" aria-selected={o.value === value} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
                className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2.5 text-left text-sm', i === active && 'bg-paper', o.value === value && 'font-700')}>
                <span className="min-w-0 truncate">{o.label}</span>
                {o.value === value ? <Icons.check size={15} className="shrink-0 text-brand" /> : o.hint && <span className="shrink-0 text-[12px] text-muted tnum">{o.hint}</span>}
              </button>
            ))}
          </div>
        </motion.div>
      )}</AnimatePresence>
    </div>
  );
}

function Stepper({ value, set, min = 1, max = 10 }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-white p-1">
      <button onClick={() => set(Math.max(min, value - 1))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-paper active:scale-95" aria-label="minus"><Icons.minus size={16} /></button>
      <span className="w-8 text-center font-display text-lg font-700 tnum">{value}</span>
      <button onClick={() => set(Math.min(max, value + 1))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-paper active:scale-95" aria-label="plus"><Icons.plus size={16} /></button>
    </div>
  );
}
function StatTile({ label, value, tone, icon, sub }) {
  const numeric = /^[\d.,%\s]+$/.test(String(value)); // figures in DM Mono; words stay in Schibsted
  return (
    <div className="rounded-xl2 border border-line bg-white p-4 shadow-card">
      <div className="flex items-center gap-2 text-muted"><span style={{ color: tone }}>{icon}</span><span className="text-[12px] font-600">{label}</span></div>
      <div className={cx('mt-1.5 text-2xl', numeric ? 'font-mono font-500 tnum' : 'font-display font-700')} style={{ color: tone }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}
function Spinner({ size = 16 }) {
  return <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: .8, ease: 'linear' }} className="inline-block">
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity=".25" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
  </motion.span>;
}
function LoadFailed({ err, retry }) {
  return (
    <div className="rounded-xl border border-heat-heavy/30 bg-white p-4 text-sm text-heat-heavy">
      Nu am putut încărca datele: {err}.{' '}
      <button onClick={retry} className="font-700 underline hover:text-ink">Reîncearcă</button>
    </div>
  );
}
const errText = (e) => String((e && e.message) || e);
function ViewHead({ title, sub, icon, right, bare }) {
  return (
    <div className={cx('flex items-end justify-between gap-3', !bare && 'mb-5')}>
      <div className="flex items-center gap-3.5">
        {icon && <span className="plastic hidden h-12 w-12 place-items-center text-brand-700 sm:grid" style={{ '--t': 'var(--color-accent-soft)' }}>{icon}</span>}
        <div><h1 className="font-display text-[26px] font-700 leading-[1.05] sm:text-[32px]">{title}</h1>{sub && <p className="mt-1 text-[13.5px] text-muted">{sub}</p>}</div>
      </div>
      {right}
    </div>
  );
}
function Empty({ icon, title, body }) {
  return (
    <div className="grid place-items-center rounded-xl2 border border-dashed border-line bg-white/60 p-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-paper text-muted">{icon}</span>
      <p className="mt-3 font-display text-lg font-700">{title}</p>
      <p className="mt-1 max-w-sm text-[13.5px] text-muted">{body}</p>
    </div>
  );
}
function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-700 text-muted">{label}</span>{children}</label>;
}
function Input(p) { return <input {...p} className={cx('w-full rounded-xl border border-muted bg-white px-3 py-2.5 text-sm outline-none focus:border-brand', p.className)} />; }
function initials(name) { return (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }
// Names are stored first name first ("Elena Popescu"): lists sort by family name, the last word, then the first names.
function familyKey(name) { const w = (name || '').trim().split(/\s+/); return [w[w.length - 1], ...w.slice(0, -1)].join(' '); }
function byFamily(a, b) { return familyKey(a.name).localeCompare(familyKey(b.name), 'ro'); }
function useCountUp(value, dur = 700) {
  const [v, setV] = useState(value); const reduce = useReducedMotion(); const prev = useRef(value);
  useEffect(() => {
    if (reduce) { setV(value); prev.current = value; return; }
    const from = prev.current, to = value, t0 = performance.now(); let raf;
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); setV(from + (to - from) * e); if (p < 1) raf = requestAnimationFrame(tick); else prev.current = to; };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [value]);
  return v;
}
function Logo({ size = 36 }) {
  return (
    <span className="grid shrink-0 place-items-center text-[var(--color-accent-ink)]" style={{ width: size, height: size, borderRadius: 10, background: 'linear-gradient(var(--color-accent), var(--color-accent-deep))', boxShadow: 'inset 0 1px 0 var(--glint), 0 0 0 1px var(--color-accent-deep), 0 3px 0 var(--color-accent-deep)' }}>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l9-5 9 5-9 5z" /><path d="M7 10v5c0 1.5 2.5 3 5 3s5-1.5 5-3v-5" /></svg>
    </span>
  );
}

/* ================= SHARED: subject pickers ================= */
function SubjectSelect({ subjects, value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand">
      <option value="" disabled>Alege materia…</option>
      {subjects.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
    </select>
  );
}
function SubjectChips({ subjects, selected, toggle }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {subjects.map((s) => { const on = selected.includes(s.code); return (
        <button key={s.code} type="button" onClick={() => toggle(s.code)} className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-700 ring-1 transition-colors', on ? 'bg-brand text-white ring-brand' : 'bg-white text-ink ring-line hover:bg-paper')}>
          <Dot hue={on ? '#fff' : s.hue} size={8} />{s.short}
        </button>
      ); })}
    </div>
  );
}

/* ================= WORKLOAD heatmap (teacher) ================= */
function Heatmap({ wl, typeLabel, canDelete, onDelete }) {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-4">
      {wl.weeks.map((wk, wi) => (
        <section key={wi} className="rounded-xl2 border border-line bg-white p-4 shadow-card sm:p-5">
          <h3 className="mb-3 text-sm font-700 text-muted">{wk.label}</h3>
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {wk.days.map((d, i) => { const h = HEAT[d.heat.k]; return (
              <motion.div key={i} initial={reduce ? false : { opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: (wi * 5 + i) * 0.03, ...spring }}
                className="plastic relative flex flex-col p-2.5 sm:p-3" style={{ '--t': h.bg, boxShadow: d.clash ? `inset 0 1.5px 0 var(--glint), inset 0 0 0 2px ${h.fg}` : undefined }}>
                <div className="flex items-center justify-between"><span className="font-mono text-[12px] font-500" style={{ color: h.fg }}>{d.dateLabel}</span>{d.clash && <Icons.alert size={13} style={{ color: h.fg }} />}</div>
                <div className="mt-2 flex-1 space-y-1">
                  {d.items.length === 0 && <span className="text-[11px]" style={{ color: h.fg, opacity: .6 }}>liber</span>}
                  {d.items.map((t, j) => { const kind = (typeLabel[t.type] || 'evaluare').toLowerCase(); const mine = onDelete && canDelete && canDelete(t);
                    const cls = 'block w-full truncate rounded-md px-1 py-1 text-left text-[10.5px] sm:px-1.5 font-600 leading-tight';
                    return mine
                      ? <button key={j} onClick={() => onDelete(t, d)} className={cx(cls, 'hover:ring-1 hover:ring-current')} style={{ color: h.fg, background: 'rgba(255,255,255,.55)' }} title={`${t.title} · atinge ca să o ștergi`}>{t.short}<span className="hidden sm:inline"> · {kind}</span></button>
                      : <div key={j} className={cls} style={{ color: h.fg, background: 'rgba(255,255,255,.55)' }} title={`${t.short} · ${kind}`}>{t.short}<span className="hidden sm:inline"> · {kind}</span></div>; })}
                </div>
                <span className="mt-2 hidden text-[10.5px] font-600 sm:block" style={{ color: h.fg, opacity: .85 }}>{d.heat.label}</span>
              </motion.div>
            ); })}
          </div>
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {[['calm', 'ușor'], ['light', 'moderat'], ['busy', 'încărcat'], ['heavy', 'supraîncărcat']].map(([k, l]) => <span key={k} className="plastic inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-600" style={{ '--t': HEAT[k].bg, color: HEAT[k].fg, borderRadius: 999 }}>{l}</span>)}
      </div>
    </div>
  );
}

/* ================= TIMETABLE grid (read-only, student) ================= */
function addMinutes(hhmm, n) {
  const total = (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + n) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function TimetableGrid({ tt, onCell }) {
  const reduce = useReducedMotion();
  // Each day is listed by start time; `period` only says which stored slot a cell uses.
  const days = tt.days.map((day) => day.map((cell, period) => cell && { ...cell, period }).filter(Boolean).sort((x, y) => x.time.localeCompare(y.time) || x.period - y.period));
  const rows = Math.min(tt.days[0].length, Math.max(7, ...days.map((d) => d.length + (onCell ? 1 : 0)))); // always room for a 7-lesson day
  return (
    <div className="overflow-x-auto no-scrollbar rounded-xl2 border border-line bg-white p-3 shadow-card">
      <div className="grid min-w-[700px] gap-2" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {DAYS.map((d, i) => <div key={d} className={cx('rounded-lg px-2 py-2 text-center text-sm font-700', i === tt.todayIdx ? 'bg-brand text-white' : 'text-ink')}>{d}</div>)}
        {Array.from({ length: rows }, (_, r) => r).map((r) => days.map((day, di) => {
          const cell = day[r];
          if (!cell) {
            const free = tt.days[di].indexOf(null);
            const last = day[day.length - 1];
            if (!onCell || free < 0) return <div key={`${r}-${di}`} className="rounded-lg border border-dashed border-line/70 min-h-[46px]" />;
            return <button key={`${r}-${di}`} onClick={() => onCell(di, free, null, last ? last.end : '08:00')} aria-label={`Adaugă în ${DAYS[di]}`} className="rounded-lg border border-dashed border-line/70 min-h-[46px] hover:border-brand hover:bg-brand-50/40" />;
          }
          return (
            <motion.button key={`${r}-${di}`} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (r * 5 + di) * 0.01 }}
              onClick={() => onCell && onCell(di, cell.period, cell)}
              className={cx('group relative rounded-lg border p-2 text-left hover:shadow-pill', di === tt.todayIdx ? 'border-brand-100 bg-brand-50/50' : 'border-line bg-white hover:border-brand-100')} style={{ borderLeft: `3px solid ${cell.hue}` }}>
              <div className="truncate text-[13px] font-700 leading-tight">{cell.short}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{cell.time}–{cell.end}</div>
              <div className="truncate text-[11px] text-muted">{cell.room || '—'}</div>
              {cell.assessment && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full" style={{ background: cell.assessment === 'tema' ? '#C98A04' : '#D92626' }} />}
            </motion.button>
          );
        }))}
      </div>
    </div>
  );
}

/* =====================================================================
 *  LOGIN
 * ===================================================================== */
// The signature object: a school week as a pill organiser, catching window light.
function OrganiserPreview() {
  const days = [
    { d: 'Lun', key: 'mon', rows: [['08:00', 'Mate'], ['10:00', 'Rom']] },
    { d: 'Mar', key: 'tue', rows: [['09:00', 'Fiz']] },
    { d: 'Mie', key: 'wed', rows: [['08:00', 'Chim'], ['11:00', 'Bio']] },
    { d: 'Joi', key: 'thu', rows: [['10:00', 'Eng']] },
    { d: 'Vin', key: 'fri', rows: [['08:00', 'Mate']], today: true },
  ];
  return (
    <div className="relative mt-10 select-none" style={{ perspective: '1100px' }} aria-hidden="true">
      <div className="pointer-events-none absolute inset-x-2 bottom-0 h-14 blur-2xl" style={{ background: 'linear-gradient(90deg, var(--p-mon), var(--p-tue), var(--p-wed), var(--p-thu), var(--p-fri))', opacity: .5 }} />
      <div className="relative flex gap-2.5" style={{ transform: 'rotateX(16deg) rotateZ(-5deg)', transformOrigin: 'center bottom' }}>
        {days.map((day) => (
          <div key={day.key} className="plastic flex-1 p-2.5" style={{ '--t': `var(--p-${day.key})`, minWidth: 0 }}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-500" style={{ color: 'var(--color-ink-2)' }}>{day.d}</span>
              {day.today && <span className="rounded-full px-1.5 text-[9px] font-700" style={{ background: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}>azi</span>}
            </div>
            <div className="mt-2 space-y-1">
              {day.rows.map(([tm, subj]) => (
                <div key={tm + subj} className="truncate rounded px-1.5 py-1 text-[9.5px] font-600" style={{ background: 'rgba(255,255,255,.6)', color: 'var(--color-ink-2)' }}>
                  <span className="font-mono">{tm}</span> {subj}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function AuthCard({ sub, onHome, children }) {
  const Brand = ({ className, children: inner }) => onHome
    ? <button type="button" onClick={onHome} aria-label="Pagina principală" className={cx(className, 'text-left')}>{inner}</button>
    : <div className={className}>{inner}</div>;
  return (
    <div className="min-h-screen" style={{ background: 'var(--color-paper)' }}>
      <div className="mx-auto min-h-screen w-full max-w-[1600px] lg:grid lg:grid-cols-[1.08fr_minmax(0,500px)]">
      <aside className="window-light relative hidden overflow-hidden px-12 py-12 xl:px-16 lg:flex lg:flex-col lg:justify-between" style={{ background: 'var(--color-paper-2)' }}>
        <Brand className="relative flex items-center gap-3 self-start"><Logo size={40} /><p className="font-display text-xl font-800 tracking-tight">SchoolPilot</p></Brand>
        <div className="relative max-w-xl">
          <h1 className="font-display font-700 leading-[1.03]" style={{ fontSize: 'clamp(2.4rem, 3.4vw, 3.4rem)' }}>Săptămâna ta de școală, pusă în ordine dinainte.</h1>
          <p className="mt-4 max-w-md text-[15.5px] text-muted">Orar, note, teme și evaluări, toate într-un singur loc — calm, clar, al tău.</p>
          <OrganiserPreview />
        </div>
        <p className="relative text-[12.5px] text-muted">Pentru elevi, profesori și administratori.</p>
      </aside>
      <main className="flex min-h-screen flex-col justify-center px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Brand className="mb-7 flex items-center gap-3 lg:hidden">
            <Logo size={42} /><div><p className="font-display text-xl font-800 tracking-tight">SchoolPilot</p><p className="text-[13px] text-muted">{sub}</p></div>
          </Brand>
          {children}
        </div>
      </main>
      </div>
    </div>
  );
}
function FormError({ children }) {
  return children ? <p role="alert" className="rounded-xl bg-heat-heavybg/70 p-3 text-[13px] text-heat-heavy">{children}</p> : null;
}
function Login({ onSignedIn, notice, onHome }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return setErr('Completează emailul și parola.');
    setBusy(true); setErr(null);
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setBusy(false); return setErr(error.status === 400 ? 'Email sau parolă greșită.' : `Nu te-am putut autentifica: ${error.message}`); }
    try { await onSignedIn(); } catch (e2) { setBusy(false); setErr(errText(e2)); }
  };
  return (
    <AuthCard sub="Intră în contul tău" onHome={onHome}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <h1 className="font-display text-xl font-700">Autentificare</h1>
        <FormError>{err || notice}</FormError>
        <Field label="Email"><Input type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nume@scoala.ro" /></Field>
        <Field label="Parolă"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ShimmerButton type="submit" className="w-full" disabled={busy}>{busy ? 'Se verifică…' : 'Intră în cont'}</ShimmerButton>
        <p className="text-center text-[12.5px] text-muted">Conturile sunt create de administratorul școlii. Dacă ți-ai uitat parola, cere-i o resetare.</p>
      </form>
    </AuthCard>
  );
}
function ChangePassword({ account, onDone, onLogout }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return setErr('Parola trebuie să aibă cel puțin 8 caractere.');
    if (pw !== pw2) return setErr('Parolele nu coincid.');
    setBusy(true); setErr(null);
    const { error } = await sb.auth.updateUser({ password: pw, data: { must_change_password: false } });
    if (error) { setBusy(false); return setErr(error.code === 'same_password' ? 'Parola nouă trebuie să fie diferită de cea temporară.' : `Nu am putut schimba parola: ${error.message}`); }
    await sb.auth.refreshSession(); // new token, so the server sees the cleared flag right away
    try { await onDone(); } catch (e2) { setBusy(false); setErr(errText(e2)); }
  };
  return (
    <AuthCard sub={account.email}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div><h1 className="font-display text-xl font-700">Setează o parolă nouă</h1><p className="mt-1 text-[13px] text-muted">Ai intrat cu o parolă temporară. Alege una nouă, doar a ta, ca să continui.</p></div>
        <FormError>{err}</FormError>
        <Field label="Parolă nouă"><Input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="minim 8 caractere" /></Field>
        <Field label="Repetă parola"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <ShimmerButton type="submit" className="w-full" disabled={busy}>{busy ? 'Se salvează…' : 'Salvează parola'}</ShimmerButton>
        <button type="button" onClick={onLogout} className="w-full text-center text-[13px] font-700 text-muted hover:text-ink">Ieși din cont</button>
      </form>
    </AuthCard>
  );
}

/* =====================================================================
 *  SHELL (sidebar + mobile nav), used by all three roles
 * ===================================================================== */
function Badge({ n }) {
  return <span aria-label={`${n} necitite`} className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-heat-heavy px-1 text-[11px] font-700 leading-none text-white tnum">{n > 99 ? '99+' : n}</span>;
}
function Profile({ account, roleLabel, onBack, onLogout }) {
  const rows = [['Email', account.email], ['Rol', roleLabel], ['Școală', account.school], ['Clasă', account.class]].filter((r) => r[1]);
  return (
    <div className="mx-auto w-full max-w-[560px] px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-700 text-muted hover:text-ink"><Icons.chevL size={16} /> Înapoi</button>
      <ViewHead title="Profilul meu" icon={<Icons.user size={22} />} />
      <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-50 font-display text-xl font-700 text-brand-600">{initials(account.name)}</span>
          <div className="min-w-0"><p className="truncate font-display text-lg font-700">{account.name}</p><p className="truncate text-[13px] text-muted">{roleLabel}</p></div>
        </div>
        <dl className="mt-4 divide-y divide-line border-t border-line">
          {rows.map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-4 py-2.5 text-[14px]"><dt className="shrink-0 text-muted">{k}</dt><dd className="min-w-0 break-words text-right font-700">{v}</dd></div>)}
        </dl>
      </div>
      <button onClick={onLogout} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 py-3 text-[14.5px] font-700 text-heat-heavy hover:bg-paper"><Icons.logout size={18} /> Ieși din cont</button>
    </div>
  );
}
function Shell({ account, nav, view, setView, onLogout, onHome, children }) {
  const reduce = useReducedMotion();
  const [profile, setProfile] = useState(false);
  const roleLabel = { admin: 'Administrator', teacher: 'Profesor', student: 'Elev' }[account.role];
  const go = (id) => { setProfile(false); setView(id); };
  const openProfile = () => { setProfile(true); window.scrollTo(0, 0); };
  const goHome = () => { setProfile(false); if (onHome) onHome(); else setView(nav[0].id); window.scrollTo(0, 0); };
  return (
    <MotionConfig reducedMotion="user">
      <div className="graph-paper daylight min-h-screen">
        <div className="flex">
          <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-line bg-white/70 px-3 py-5 backdrop-blur lg:flex">
            <button onClick={goHome} aria-label="Pagina principală" className="flex items-center gap-2.5 px-2 text-left"><Logo /><div className="leading-none"><p className="font-display text-lg font-800 tracking-tight">SchoolPilot</p><p className="mt-0.5 text-[11px] text-muted">{roleLabel}</p></div></button>
            <nav className="mt-7 flex flex-col gap-1">
              {nav.map((n) => { const on = !profile && view === n.id; return (
                <button key={n.id} onClick={() => go(n.id)} className={cx('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-700 transition-colors', on ? 'text-brand-600' : 'text-muted hover:bg-paper hover:text-ink')}>
                  {on && <motion.span layoutId="rail-active" transition={spring} className="absolute inset-0 rounded-xl bg-brand-50 ring-1 ring-brand-100" />}
                  <span className="relative z-10"><n.icon size={20} /></span><span className="relative z-10">{n.label}</span>
                  {n.badge > 0 && <span className="relative z-10 ml-auto"><Badge n={n.badge} /></span>}
                </button>
              ); })}
            </nav>
            <button onClick={openProfile} aria-label="Profilul meu" className="mt-auto w-full rounded-xl border border-line bg-white p-2 text-left hover:bg-paper">
              <div className="flex items-center gap-2.5 px-1 py-1">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 font-700 text-brand-600 text-[13px]">{initials(account.name)}</span>
                <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-700">{account.name}</span><span className="block truncate text-[11px] text-muted">{account.school || roleLabel}</span></span>
              </div>
            </button>
            <button onClick={onLogout} className="mt-1.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-700 text-muted hover:bg-heat-heavybg/60 hover:text-heat-heavy"><Icons.logout size={16} /> Ieși din cont</button>
          </aside>

          <main className="min-w-0 flex-1">
            {account.demo && (
              <div className="flex items-center justify-between gap-3 bg-brand px-4 py-2 text-[13px] font-600 text-white" role="status">
                <span>Mod demo: ești {account.name}, din {account.class}.</span>
                <button onClick={onLogout} className="shrink-0 rounded-full bg-white/15 px-3 py-1 font-700 hover:bg-white/25">Ieși</button>
              </div>
            )}
            <header className="edge-b sticky top-0 z-30 flex items-center justify-between bg-white/80 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
              <button onClick={goHome} aria-label="Pagina principală" className="flex items-center gap-2"><Logo size={30} /><span className="font-display text-base font-800">SchoolPilot</span></button>
              <div className="flex items-center gap-1.5">
                <button onClick={openProfile} aria-label="Profilul meu" className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-1.5 text-[12.5px] font-700"><Icons.user size={14} /> {roleLabel}</button>
                <button onClick={onLogout} aria-label="Ieși din cont" title="Ieși din cont" className="grid h-8 w-8 place-items-center rounded-full bg-paper text-muted hover:text-heat-heavy"><Icons.logout size={15} /></button>
              </div>
            </header>
            <AnimatePresence mode="wait">
              <motion.div key={profile ? 'profile' : view} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? {} : { opacity: 0, y: -8 }} transition={{ duration: .22 }}>
                {profile ? <Profile account={account} roleLabel={roleLabel} onBack={() => setProfile(false)} onLogout={onLogout} /> : children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        {nav.length > 1 && (
          <nav className="edge-t fixed inset-x-0 bottom-0 z-30 bg-white/90 backdrop-blur lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="mx-auto flex max-w-md items-stretch justify-around px-1 py-1.5">
              {nav.map((n) => { const on = !profile && view === n.id; return (
                <button key={n.id} onClick={() => go(n.id)} className="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5">
                  {on && <motion.span layoutId="tab-active" transition={spring} className="absolute inset-x-2 top-0 h-1 rounded-full bg-brand" />}
                  <span className="relative"><n.icon size={21} className={on ? 'text-brand' : 'text-muted'} />{n.badge > 0 && <span className="absolute -right-2.5 -top-1.5"><Badge n={n.badge} /></span>}</span><span className={cx('font-700', nav.length > 5 ? 'text-[9.5px]' : 'text-[10.5px]', on ? 'text-brand' : 'text-muted')}>{n.label}</span>
                </button>
              ); })}
            </div>
          </nav>
        )}
      </div>
    </MotionConfig>
  );
}

/* =====================================================================
 *  ADMIN
 * ===================================================================== */
function AdminApp({ account, onLogout }) {
  const [a, setA] = useState(null);
  const [view] = useState('admin');
  const [schoolId, setSchoolId] = useState(null);
  const [tab, setTab] = useState('classes');
  const [err, setErr] = useState(null);
  const load = useCallback(() => API.get('/api/admin').then((d) => { setErr(null); setA(d); }).catch((e) => setErr(errText(e))), []);
  useEffect(() => { load(); }, [load]);
  if (!a) return <Shell account={account} nav={[{ id: 'admin', label: 'Administrare', icon: Icons.building }]} view="admin" setView={() => {}} onLogout={onLogout}>{err ? <div className="p-6"><LoadFailed err={err} retry={load} /></div> : <div className="p-10 text-muted"><Spinner size={18} /> Se încarcă…</div>}</Shell>;
  const school = a.schools.find((s) => s.id === schoolId) || null;
  return (
    <Shell account={account} nav={[{ id: 'admin', label: 'Administrare', icon: Icons.building }]} view={view} setView={() => {}} onLogout={onLogout} onHome={() => setSchoolId(null)}>
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
        {!school
          ? <AdminSchools a={a} reload={load} onOpen={(id) => { setSchoolId(id); setTab('classes'); }} />
          : <AdminSchool a={a} school={school} tab={tab} setTab={setTab} back={() => setSchoolId(null)} reload={load} />}
      </div>
    </Shell>
  );
}

function AdminSchools({ a, reload, onOpen }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, once] = useBusy();
  const add = once(() => { if (!name.trim()) return; return API.post('/api/schools', { name }).then(() => { setName(''); setAdding(false); toast.success('Școala a fost adăugată.'); return reload(); }).catch(toastError); });
  const del = async (s) => {
    if (!await askConfirm({ title: `Ștergi școala „${s.name}”?`, body: 'Clasele, orarul, profesorii și elevii ei vor fi șterși, împreună cu toate conturile.', action: 'Șterge școala' })) return;
    API.del(`/api/schools/${s.id}`).then(() => { toast.success('Școala a fost ștearsă.'); return reload(); }).catch(toastError);
  };
  return (
    <div>
      <ViewHead title="Școli" sub="Adaugă o școală, apoi construiește clasele, profesorii, elevii și orarul." icon={<Icons.building />}
        right={<ShimmerButton icon={<Icons.plus size={18} />} onClick={() => setAdding(true)}>Adaugă școală</ShimmerButton>} />
      {a.schools.length === 0 && !adding && <Empty icon={<Icons.building size={26} />} title="Nicio școală încă" body="Începe prin a adăuga prima școală. Totul pornește de la zero — tu construiești structura." />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {a.schools.map((s) => (
          <div key={s.id} className="group rounded-xl2 border border-line bg-white p-5 shadow-card transition-colors hover:border-brand-200">
            <div className="flex items-start justify-between">
              <button onClick={() => onOpen(s.id)} className="flex items-center gap-3 text-left">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand"><Icons.building size={22} /></span>
                <span><span className="block font-700">{s.name}</span><span className="block text-[12.5px] text-muted">{plural(s.classes.length, 'clasă', 'clase')}, {plural(s.teachers.length, 'profesor', 'profesori')}, {plural(s.students.length, 'elev', 'elevi')}</span></span>
              </button>
              <button onClick={() => del(s)} className="grid h-8 w-8 place-items-center rounded-lg text-muted lg:opacity-0 transition-opacity hover:bg-heat-heavybg hover:text-heat-heavy lg:group-hover:opacity-100"><Icons.trash size={16} /></button>
            </div>
            <button onClick={() => onOpen(s.id)} className="mt-4 inline-flex items-center gap-1 text-sm font-700 text-brand hover:text-brand-600">Deschide <Icons.chevR size={15} /></button>
          </div>
        ))}
      </div>
      <Sheet open={adding} onClose={() => setAdding(false)} labelledBy="sch-t">
        {adding && <Modal>
          <h3 id="sch-t" className="font-display text-xl font-700">Adaugă o școală</h3>
          <div className="mt-4"><Field label="Numele școlii"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="ex. Colegiul Național Mihai Viteazul" /></Field></div>
          <div className="mt-5 flex gap-2"><ShimmerButton className="flex-1" onClick={add} disabled={busy}>Salvează</ShimmerButton><button onClick={() => setAdding(false)} className="rounded-xl border border-line px-4 font-700 text-muted hover:bg-paper">Anulează</button></div>
        </Modal>}
      </Sheet>
    </div>
  );
}

function AdminSchool({ a, school, tab, setTab, back, reload }) {
  const sections = [
    { id: 'classes', label: 'Clase', icon: Icons.users, count: school.classes.length },
    { id: 'teachers', label: 'Profesori', icon: Icons.teacher, count: school.teachers.length },
    { id: 'students', label: 'Elevi', icon: Icons.user, count: school.students.length },
    { id: 'timetable', label: 'Orar', icon: Icons.grid },
    { id: 'announcements', label: 'Anunțuri', icon: Icons.megaphone },
  ];
  return (
    <div>
      <button onClick={back} className="mb-3 inline-flex items-center gap-1 text-sm font-700 text-muted hover:text-ink"><Icons.chevL size={16} /> Toate școlile</button>
      <ViewHead title={school.name} sub="Construiește structura școlii" bare />
      <div className="mt-4 lg:hidden"><FluidTabs id="admin" active={tab} onChange={setTab} tabs={sections.map((t) => ({ id: t.id, label: t.label, icon: <t.icon size={15} /> }))} fill /></div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[216px_minmax(0,1fr)]">
        <nav aria-label="Secțiuni" className="hidden lg:block">
          <div className="sticky top-5 space-y-1">
            {sections.map((t) => { const on = tab === t.id; return (
              <button key={t.id} onClick={() => setTab(t.id)} className={cx('group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-700 transition-colors', on ? 'text-brand-700' : 'text-muted hover:bg-paper hover:text-ink')}>
                {on && <motion.span layoutId="admin-rail" transition={spring} className="plastic absolute inset-0" style={{ '--t': 'var(--color-accent-soft)' }} />}
                <span className="relative z-10"><t.icon size={18} /></span><span className="relative z-10 flex-1">{t.label}</span>
                {t.count !== undefined && <span className="relative z-10 font-mono text-[12px] text-muted">{t.count}</span>}
              </button>
            ); })}
          </div>
        </nav>
        <div className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .18 }}>
              {tab === 'classes' && <AdminClasses school={school} reload={reload} />}
              {tab === 'teachers' && <AdminTeachers a={a} school={school} reload={reload} />}
              {tab === 'students' && <AdminStudents school={school} reload={reload} />}
              {tab === 'timetable' && <AdminTimetable a={a} school={school} reload={reload} />}
              {tab === 'announcements' && <Announcements school={school} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function AdminModules({ school, reload }) {
  const [rows, setRows] = useState(school.modules);
  const [busy, setBusy] = useState(false);
  const change = (i, key, v) => setRows((l) => l.map((m, j) => (j === i ? { ...m, [key]: v } : m)));
  const save = () => {
    setBusy(true);
    API.post(`/api/schools/${school.id}/modules`, { modules: rows }).then(() => { toast.success('Modulele au fost salvate.'); return reload(); }).catch(toastError).finally(() => setBusy(false));
  };
  return (
    <section className="mt-6 rounded-xl2 border border-line bg-white p-4 shadow-card">
      <h2 className="font-display text-lg font-700">Anul școlar</h2>
      <p className="mt-0.5 text-[13px] text-muted">Între module e vacanță: elevii nu văd ore. Modulele 3 și 4 diferă pe județ, așa că verifică datele inspectoratului.</p>
      <div className="mt-3 space-y-3">{rows.map((m, i) => (
        <div key={m.number} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[96px_1fr_1fr]">
          <span className="col-span-2 text-[13px] font-700 sm:col-span-1 sm:pb-2.5">Modulul {m.number}</span>
          <Field label="Început"><Input type="date" value={m.start} onChange={(e) => change(i, 'start', e.target.value)} /></Field>
          <Field label="Sfârșit"><Input type="date" value={m.end} onChange={(e) => change(i, 'end', e.target.value)} /></Field>
        </div>
      ))}</div>
      <ShimmerButton className="mt-4" disabled={busy} onClick={save}>Salvează modulele</ShimmerButton>
    </section>
  );
}
function AdminClasses({ school, reload }) {
  const [name, setName] = useState('');
  const [busy, once] = useBusy();
  const add = once(() => { if (!name.trim()) return; return API.post('/api/classes', { schoolId: school.id, name }).then(() => { setName(''); toast.success('Clasa a fost adăugată.'); return reload(); }).catch(toastError); });
  const del = async (c) => {
    if (!await askConfirm({ title: `Ștergi clasa ${c.name}?`, body: 'Orarul și evaluările clasei vor fi șterse. Elevii rămân în școală, fără clasă.', action: 'Șterge clasa' })) return;
    API.del(`/api/classes/${c.id}`).then(() => { toast.success('Clasa a fost ștearsă.'); return reload(); }).catch(toastError);
  };
  const setHomeroom = (c, id) => API.patch(`/api/classes/${c.id}`, { homeroomTeacherId: id ? Number(id) : null }).then(() => { toast.success('Dirigintele a fost salvat.'); return reload(); }).catch(toastError);
  return (
    <div>
      <div className="mb-4 flex items-end gap-2">
        <div className="flex-1 sm:max-w-xs"><Field label="Nume clasă"><Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="ex. 10B" /></Field></div>
        <ShimmerButton icon={<Icons.plus size={18} />} onClick={add} disabled={busy}>Adaugă</ShimmerButton>
      </div>
      {school.classes.length === 0 ? <Empty icon={<Icons.users size={26} />} title="Nicio clasă" body="Adaugă o clasă (ex. 9A, 10B). Elevii și orarul se leagă de o clasă." />
        : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {school.classes.map((c) => (
              <div key={c.id} className="group rounded-xl2 border border-line bg-white p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <div><p className="font-display text-xl font-700">{c.name}</p><p className="text-[12px] text-muted">{plural(c.students, 'elev', 'elevi')}, {plural(c.slots, 'oră', 'ore')}</p></div>
                  <button onClick={() => del(c)} aria-label={`Șterge clasa ${c.name}`} className="grid h-8 w-8 place-items-center rounded-lg text-muted lg:opacity-0 hover:bg-heat-heavybg hover:text-heat-heavy lg:group-hover:opacity-100 focus:opacity-100"><Icons.trash size={16} /></button>
                </div>
                <div className="mt-3"><Field label="Diriginte"><select value={c.homeroomTeacherId || ''} onChange={(e) => setHomeroom(c, e.target.value)} className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand">
                  <option value="">— fără diriginte —</option>
                  {school.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></Field></div>
              </div>
            ))}
          </div>}
      {school.classes.length > 0 && <section className="mt-6">
        <h2 className="mb-3 font-display text-lg font-700">Situația claselor</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{school.classes.map((c) => { const n = c.insights; return (
          <div key={c.id} className="rounded-xl2 border border-line bg-white p-4 shadow-card">
            <p className="font-display text-lg font-700">{c.name}</p>
            <dl className="mt-2 space-y-1 text-[13px]">
              {[['Media notelor', n.average === null ? '—' : n.average.toFixed(2)], ['Medii sub 6', n.atRisk], ['Absențe nemotivate', n.unexcused], ['Evaluări prea apropiate', n.clashes], ['Ziua cea mai grea', n.busiest || '—']].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="font-700 tnum">{v}</dd></div>)}
            </dl>
          </div>
        ); })}</div>
      </section>}
      <AdminModules key={school.id} school={school} reload={reload} />
    </div>
  );
}

/* Temporary password, shown to the admin exactly once (after create or reset). */
function TempPassword({ issued, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(issued.tempPassword).then(done).catch(() => {});
  };
  return (
    <Sheet open={!!issued} onClose={onClose} labelledBy="tp-t">
      {issued && <Modal>
        <h3 id="tp-t" className="font-display text-xl font-700">{issued.title}</h3>
        <p className="mt-1 text-sm text-muted">Parola temporară pentru <b className="text-ink">{issued.email}</b>:</p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 select-all rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-lg font-700 tracking-wide">{issued.tempPassword}</code>
          <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-sm font-700 text-ink hover:bg-paper"><Icons.copy size={16} />{copied ? 'Copiat' : 'Copiază'}</button>
        </div>
        <p className="mt-3 rounded-xl bg-heat-lightbg/60 p-3 text-[13px] text-ink/80">Parola apare o singură dată. Trimite-o persoanei; la prima autentificare va trebui să își aleagă una nouă.</p>
        <div className="mt-5"><ShimmerButton className="w-full" onClick={onClose}>Am salvat parola</ShimmerButton></div>
      </Modal>}
    </Sheet>
  );
}
/* Create / reset / delete a teacher or student login. */
function useAccounts(reload) {
  const [issued, setIssued] = useState(null);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const create = (path, body, done) => {
    if (!body.name.trim()) return setFormErr('Completează numele.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())) return setFormErr('Completează un email valid.');
    setBusy(true); setFormErr(null);
    API.post(path, { ...body, email: body.email.trim() })
      .then((r) => { done(); setIssued({ title: 'Cont creat', ...r }); toast.success('Contul a fost creat.'); return reload(); })
      .catch((e) => setFormErr(errText(e)))
      .finally(() => setBusy(false));
  };
  const reset = async (u) => {
    if (!await askConfirm({ title: `Resetezi parola pentru ${u.name}?`, body: 'Se generează o parolă temporară nouă, iar cea actuală nu va mai funcționa.', action: 'Resetează parola' })) return;
    API.post(`/api/users/${u.id}/reset-password`).then((r) => { setIssued({ title: 'Parolă resetată', ...r }); toast.success('Parola a fost resetată.'); }).catch(toastError);
  };
  const del = async (u, what) => {
    const body = what === 'elevul' ? 'Notele și absențele lui vor fi șterse, împreună cu contul de autentificare.' : 'Contul lui de autentificare va fi șters. Notele și absențele introduse rămân în catalog.';
    if (!await askConfirm({ title: `Ștergi ${what} ${u.name}?`, body, action: 'Șterge' })) return;
    API.del(`/api/users/${u.id}`).then(() => { toast.success('Contul a fost șters.'); return reload(); }).catch(toastError);
  };
  return { issued, closeIssued: () => setIssued(null), formErr, setFormErr, busy, create, reset, del };
}
function AccountRowActions({ u, acc, what }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {u.hasLogin && <button onClick={() => acc.reset(u)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-700 text-muted hover:bg-paper hover:text-ink"><Icons.key size={15} /><span className="hidden sm:inline">Resetează parola</span></button>}
      <button onClick={() => acc.del(u, what)} aria-label={`Șterge ${u.name}`} className="grid h-8 w-8 place-items-center rounded-lg text-muted lg:opacity-0 hover:bg-heat-heavybg hover:text-heat-heavy lg:group-hover:opacity-100 focus:opacity-100"><Icons.trash size={16} /></button>
    </div>
  );
}

function AdminTeachers({ a, school, reload }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subs, setSubs] = useState([]);
  const acc = useAccounts(reload);
  const add = () => acc.create('/api/teachers', { schoolId: school.id, name, email, subjects: subs }, () => { setName(''); setEmail(''); setSubs([]); setOpen(false); });
  const subjName = (code) => (a.subjects.find((s) => s.code === code) || {}).short || code;
  return (
    <div>
      <div className="mb-4"><ShimmerButton icon={<Icons.plus size={18} />} onClick={() => { acc.setFormErr(null); setOpen(true); }}>Adaugă profesor</ShimmerButton></div>
      {school.teachers.length === 0 ? <Empty icon={<Icons.teacher size={26} />} title="Niciun profesor" body="Adaugă profesori și materiile pe care le predau. Apoi îi poți pune în orar." />
        : <div className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card">
            {school.teachers.map((t, i) => (
              <div key={t.id} className={cx('group flex items-center gap-3 p-4', i && 'border-t border-line')}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#7C3AED]/10 font-700 text-[#7C3AED] text-[13px]">{initials(t.name)}</span>
                <div className="min-w-0 flex-1"><p className="truncate font-700">{t.name}</p><p className="truncate text-[12.5px] text-muted">{t.email || 'fără login'} · {t.subjects.length ? t.subjects.map(subjName).join(', ') : 'fără materii'}</p></div>
                <AccountRowActions u={t} acc={acc} what="profesorul" />
              </div>
            ))}
          </div>}
      <Sheet open={open} onClose={() => setOpen(false)} labelledBy="t-t">
        {open && <Modal>
          <h3 id="t-t" className="font-display text-xl font-700">Adaugă profesor</h3>
          <div className="mt-4 space-y-4">
            <FormError>{acc.formErr}</FormError>
            <Field label="Nume"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. d-na Ionescu" /></Field>
            <Field label="Email (pentru autentificare)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nume@scoala.ro" /></Field>
            <div><span className="mb-1 block text-[12px] font-700 text-muted">Materii predate</span><SubjectChips subjects={a.subjects} selected={subs} toggle={(c) => setSubs((s) => s.includes(c) ? s.filter((x) => x !== c) : [...s, c])} /></div>
          </div>
          <div className="mt-5 flex gap-2"><ShimmerButton className="flex-1" onClick={add} disabled={acc.busy}>{acc.busy ? 'Se creează…' : 'Salvează'}</ShimmerButton><button onClick={() => setOpen(false)} className="rounded-xl border border-line px-4 font-700 text-muted hover:bg-paper">Anulează</button></div>
        </Modal>}
      </Sheet>
      <TempPassword issued={acc.issued} onClose={acc.closeIssued} />
    </div>
  );
}

function AdminStudents({ school, reload }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [classId, setClassId] = useState(school.classes[0] ? String(school.classes[0].id) : '');
  const acc = useAccounts(reload);
  const add = () => acc.create('/api/students', { schoolId: school.id, name, email, classId: classId ? Number(classId) : null }, () => { setName(''); setEmail(''); setOpen(false); });
  return (
    <div>
      <div className="mb-4"><ShimmerButton icon={<Icons.plus size={18} />} onClick={() => { setClassId(school.classes[0] ? String(school.classes[0].id) : ''); acc.setFormErr(null); setOpen(true); }}>Adaugă elev</ShimmerButton></div>
      {school.classes.length === 0 && <p className="mb-3 rounded-xl bg-heat-lightbg/60 p-3 text-[13px] text-heat-light">Adaugă întâi o clasă, ca să poți repartiza elevii.</p>}
      {school.students.length === 0 ? <Empty icon={<Icons.user size={26} />} title="Niciun elev" body="Adaugă elevi și repartizează-i la o clasă. Fiecare elev va avea propriul cont." />
        : <div className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card">
            {[...school.students].sort(byFamily).map((s, i) => (
              <div key={s.id} className={cx('group flex items-center gap-3 p-4', i && 'border-t border-line')}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#E8650E]/10 font-700 text-[#E8650E] text-[13px]">{initials(s.name)}</span>
                <div className="min-w-0 flex-1"><p className="truncate font-700">{s.name}</p><p className="truncate text-[12.5px] text-muted">{s.email || 'fără login'} · {s.className || 'fără clasă'}</p></div>
                <AccountRowActions u={s} acc={acc} what="elevul" />
              </div>
            ))}
          </div>}
      <Sheet open={open} onClose={() => setOpen(false)} labelledBy="s-t">
        {open && <Modal>
          <h3 id="s-t" className="font-display text-xl font-700">Adaugă elev</h3>
          <div className="mt-4 space-y-4">
            <FormError>{acc.formErr}</FormError>
            <Field label="Nume"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Ana Popescu" /></Field>
            <Field label="Email (pentru autentificare)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nume@scoala.ro" /></Field>
            <Field label="Clasă"><select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand"><option value="">— fără clasă —</option>{school.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          </div>
          <div className="mt-5 flex gap-2"><ShimmerButton className="flex-1" onClick={add} disabled={acc.busy}>{acc.busy ? 'Se creează…' : 'Salvează'}</ShimmerButton><button onClick={() => setOpen(false)} className="rounded-xl border border-line px-4 font-700 text-muted hover:bg-paper">Anulează</button></div>
        </Modal>}
      </Sheet>
      <TempPassword issued={acc.issued} onClose={acc.closeIssued} />
    </div>
  );
}

function AdminTimetable({ a, school, reload }) {
  const [classId, setClassId] = useState(school.classes[0] ? school.classes[0].id : null);
  const [tt, setTt] = useState(null);
  const [edit, setEdit] = useState(null); // {day, period, cell}
  const [err, setErr] = useState(null);
  const loadTT = useCallback(() => { if (classId) API.get(`/api/timetable?classId=${classId}`).then((d) => { setErr(null); setTt(d); }).catch((e) => setErr(errText(e))); }, [classId]);
  useEffect(() => { loadTT(); }, [loadTT]);
  if (school.classes.length === 0) return <Empty icon={<Icons.grid size={26} />} title="Fără orar încă" body="Adaugă o clasă întâi, apoi construiește orarul oră cu oră." />;
  const grid = tt ? { periods: tt.periods, todayIdx: tt.todayIdx, days: tt.grid[0].map((_, pi) => null) && [0, 1, 2, 3, 4].map((di) => tt.grid[di]) } : null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-700 text-muted">Clasa:</span>
        {school.classes.map((c) => <button key={c.id} onClick={() => setClassId(c.id)} className={cx('rounded-lg px-3 py-1.5 text-[13px] font-700 ring-1 transition-colors', classId === c.id ? 'bg-brand text-white ring-brand' : 'bg-white text-ink ring-line hover:bg-paper')}>{c.name}</button>)}
      </div>
      <p className="mb-3 text-[13px] text-muted">Atinge o celulă ca să pui / schimbi o oră. Fiecare zi se ordonează singură după ora de început. Punct roșu = are o evaluare programată de profesor.</p>
      {grid ? <TimetableGrid tt={grid} onCell={(day, period, cell, start) => setEdit({ day, period, cell, start })} /> : err ? <LoadFailed err={err} retry={loadTT} /> : <div className="p-6 text-muted"><Spinner size={16} /> …</div>}
      <Sheet open={!!edit} onClose={() => setEdit(null)} labelledBy="tt-e">
        {edit && <TimetableCellEditor a={a} school={school} classId={classId} edit={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); loadTT(); reload(); }} />}
      </Sheet>
    </div>
  );
}

function TimetableCellEditor({ a, school, classId, edit, onClose, onSaved }) {
  const existing = edit.cell;
  const [subject, setSubject] = useState(existing ? existing.subject : '');
  const [teacherId, setTeacherId] = useState(existing && existing.teacherId ? String(existing.teacherId) : '');
  const [room, setRoom] = useState(existing ? existing.room : '');
  const [time, setTime] = useState(existing ? existing.time : edit.start);
  const [end, setEnd] = useState(existing ? existing.end : addMinutes(edit.start, 50));
  const [endChosen, setEndChosen] = useState(!!existing); // until then, the end follows the start
  const [err, setErr] = useState(null);
  const changeStart = (v) => { setTime(v); if (v && !endChosen) setEnd(addMinutes(v, 50)); };
  const save = () => {
    if (!subject) return setErr('Alege materia.');
    if (!time || !end) return setErr('Alege ora de început și ora de sfârșit.');
    API.post('/api/timetable', { classId, day: edit.day, period: edit.period, subject, teacherId: teacherId ? Number(teacherId) : null, room, time, end }).then(() => { toast.success(existing ? 'Ora a fost actualizată.' : 'Ora a fost adăugată în orar.'); onSaved(); }).catch(toastError);
  };
  const remove = () => { if (existing) API.del(`/api/timetable/${existing.id}`).then(() => { toast.success('Ora a fost ștearsă din orar.'); onSaved(); }).catch(toastError); };
  // teachers that teach this subject first, then the rest
  const teachers = [...school.teachers].sort((x, y) => (y.subjects.includes(subject) ? 1 : 0) - (x.subjects.includes(subject) ? 1 : 0));
  return (
    <Modal>
      <h3 id="tt-e" className="font-display text-xl font-700">{DAYS[edit.day]}</h3>
      <div className="mt-4 space-y-4">
        <FormError>{err}</FormError>
        <Field label="Materie"><SubjectSelect subjects={a.subjects} value={subject} onChange={setSubject} /></Field>
        <div><span className="mb-1 block text-[12px] font-700 text-muted">Profesor</span>
          <SearchSelect inline label="Profesor" value={teacherId} onChange={setTeacherId} placeholder="— alege profesor —" searchPlaceholder="Caută profesorul…" empty="Niciun profesor găsit."
            options={[{ value: '', label: '— fără profesor —' }, ...teachers.map((t) => ({ value: String(t.id), label: t.name, hint: subject && t.subjects.includes(subject) ? 'predă materia' : '' }))]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ora de început"><Input type="time" value={time} onChange={(e) => changeStart(e.target.value)} /></Field>
          <Field label="Ora de sfârșit"><Input type="time" value={end} onChange={(e) => { setEnd(e.target.value); setEndChosen(true); }} /></Field>
        </div>
        <Field label="Sala"><Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="ex. A24 / Lab F" /></Field>
      </div>
      <div className="mt-5 flex gap-2">
        <ShimmerButton className="flex-1" onClick={save}>{existing ? 'Actualizează' : 'Pune în orar'}</ShimmerButton>
        {existing && <button onClick={remove} className="grid place-items-center rounded-xl border border-line px-4 text-heat-heavy hover:bg-heat-heavybg"><Icons.trash size={18} /></button>}
        <button onClick={onClose} className="rounded-xl border border-line px-4 font-700 text-muted hover:bg-paper">Închide</button>
      </div>
    </Modal>
  );
}

/* =====================================================================
 *  TEACHER
 * ===================================================================== */
const TYPE_LABEL = { test: 'Lucrare', quiz: 'Ascultare', tema: 'Temă' };
function TeacherApp({ account, onLogout }) {
  const [view, setView] = useState('schedule');
  const [t, setT] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => API.get('/api/teacher').then((d) => { setErr(null); setT(d); }).catch((e) => setErr(errText(e))), [account.id]);
  useEffect(() => { load(); }, [load]);
  const nav = [{ id: 'schedule', label: 'Orarul meu', icon: Icons.grid }, { id: 'catalog', label: 'Catalog', icon: Icons.chart }, { id: 'workload', label: 'Încărcare', icon: Icons.pulse }, { id: 'announcements', label: 'Anunțuri', icon: Icons.megaphone }, { id: 'messages', label: 'Mesaje', icon: Icons.message, badge: t ? t.unreadMessages : 0 }];
  return (
    <Shell account={account} nav={nav} view={view} setView={setView} onLogout={onLogout}>
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
        {!t ? (err ? <LoadFailed err={err} retry={load} /> : <div className="p-10 text-muted"><Spinner size={18} /> Se încarcă…</div>)
          : view === 'schedule' ? <TeacherSchedule t={t} reload={load} />
          : view === 'catalog' ? <TeacherCatalog t={t} />
          : view === 'announcements' ? <Announcements canPost />
          : view === 'messages' ? <Messages onRead={load} />
          : <TeacherWorkload t={t} />}
      </div>
    </Shell>
  );
}
const nextDateFor = (dayIdx) => {
  const d = new Date();
  d.setDate(d.getDate() + ((dayIdx + 8 - d.getDay()) % 7)); // dayIdx 0 = Monday
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function LessonChangeForm({ lesson, colleagues, onClose, onSaved }) {
  const [date, setDate] = useState(nextDateFor(lesson.day));
  const [kind, setKind] = useState('cancelled');
  const [room, setRoom] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true);
    API.post('/api/lesson-changes', { timetableId: lesson.id, date, kind, room, teacherId, note }).then(() => { toast.success('Elevii au fost anunțați.'); onSaved(); }).catch(toastError).finally(() => setBusy(false));
  };
  return (
    <Modal>
      <h3 id="lc-t" className="font-display text-xl font-700">Schimbă ora</h3>
      <p className="text-sm text-muted">{lesson.subjectName} · {lesson.className} · {DAYS[lesson.day]}, {lesson.time}</p>
      <div className="mt-4 space-y-4">
        <PickChips label="Tip" options={[{ id: 'cancelled', label: 'Anulată' }, { id: 'room', label: 'Altă sală' }, { id: 'substitute', label: 'Suplinire' }]} value={kind} onChange={setKind} />
        <Field label="Data"><Input type="date" value={date} min={nextDateFor(lesson.day)} step={7} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind === 'room' && <Field label="Sala nouă"><Input value={room} maxLength={40} onChange={(e) => setRoom(e.target.value)} placeholder="ex. A24" /></Field>}
        {kind === 'substitute' && <div><span className="mb-1 block text-[12px] font-700 text-muted">Suplinitor</span>
          <SearchSelect inline label="Suplinitor" value={teacherId} onChange={setTeacherId} placeholder="— alege profesor —" searchPlaceholder="Caută profesorul…" empty="Niciun profesor găsit." options={colleagues.map((c) => ({ value: String(c.id), label: c.name }))} /></div>}
        <Field label="Observație (opțional)"><Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="mt-5 flex gap-2"><ShimmerButton className="flex-1" disabled={busy} onClick={save}>Anunță elevii</ShimmerButton><button onClick={onClose} className="rounded-xl border border-line px-4 font-700 text-muted hover:bg-paper">Renunță</button></div>
    </Modal>
  );
}
/* Kokonut-adapted split-flap number (departure-board flourish), Motion-driven. */
function SplitFlap({ value, big }) {
  const reduce = useReducedMotion();
  const sz = big ? 'text-3xl px-2 py-1 sm:text-[2.6rem]' : 'text-[13px] px-1 py-0.5';
  return (
    <span className={cx('inline-flex items-end font-mono tabular-nums', big ? 'gap-1' : 'gap-0.5')} aria-label={String(value)}>
      {String(value).split('').map((ch, i) => {
        const sep = ch === '.' || ch === ',';
        return sep
          ? <span key={i} aria-hidden="true" className={cx('leading-none', big ? 'px-0.5 text-3xl sm:text-[2.6rem]' : 'text-[13px]')} style={{ color: 'var(--color-ink)' }}>{ch}</span>
          : <span key={i} aria-hidden="true" className={cx('relative inline-block overflow-hidden rounded leading-none', sz)} style={{ background: 'var(--color-ink)', color: 'var(--color-accent-ink)' }}>
              <AnimatePresence mode="popLayout" initial={!reduce}>
                <motion.span key={ch} initial={reduce ? false : { y: '-110%' }} animate={{ y: 0 }} exit={{ y: '110%' }} transition={{ type: 'spring', stiffness: 320, damping: 26 }} className="block">{ch}</motion.span>
              </AnimatePresence>
            </span>;
      })}
    </span>
  );
}

function TeacherSchedule({ t, reload }) {
  const reduce = useReducedMotion();
  const hasAny = t.schedule.some((d) => d.length);
  const [changing, setChanging] = useState(null);
  const undo = async (c) => {
    if (!await askConfirm({ title: `Anulezi schimbarea din ${fmtDate(c.date)}?`, body: `${c.subjectName}, ${c.className}: ora revine la programul obișnuit.`, action: 'Anulează schimbarea' })) return;
    API.del(`/api/lesson-changes/${c.id}`).then(() => { toast.success('Schimbarea a fost anulată.'); return reload(); }).catch(toastError);
  };
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const all = t.schedule.flat();
  const start = Math.floor(Math.min(8 * 60, ...all.map((s) => toMin(s.time))) / 60) * 60;
  const end = Math.ceil(Math.max(14 * 60, ...all.map((s) => toMin(s.end))) / 60) * 60;
  const PX = 1.3, H = (end - start) * PX;
  const hours = []; for (let h = start; h <= end; h += 60) hours.push(h);
  const fmtH = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:00`;
  return (
    <div>
      <ViewHead title="Orarul meu" sub={t.classes.length ? `Orele tale la ${t.classes.map((c) => c.name).join(', ')}` : 'Doar orele tale'} icon={<Icons.grid />}
        right={all.length > 0 && <div className="hidden items-center gap-2 sm:flex"><SplitFlap value={all.length} /><span className="text-[13px] font-600 text-muted">ore pe săptămână</span></div>} />
      {t.changes.length > 0 && <ul className="mb-4 overflow-hidden rounded-xl2 border border-line bg-white shadow-card">{t.changes.map((c, i) => (
        <li key={c.id} className={cx('flex items-center gap-3 p-3.5', i && 'border-t border-line')}>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-700">{c.label}</p><p className="truncate text-[12.5px] text-muted">{c.subjectName}, {c.className}, {fmtDate(c.date)} {c.time}</p></div>
          {c.mine && <button onClick={() => undo(c)} aria-label="Anulează schimbarea" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-heat-heavybg hover:text-heat-heavy"><Icons.trash size={16} /></button>}
        </li>
      ))}</ul>}
      {!hasAny ? <Empty icon={<Icons.grid size={26} />} title="Nu ai ore încă" body="Administratorul te pune în orar. Odată adăugat, vei vedea aici doar orele tale." />
        : <div className="overflow-x-auto no-scrollbar rounded-xl2 border border-line bg-white p-3 shadow-card sm:p-4">
            <div className="grid min-w-[720px] gap-x-2" style={{ gridTemplateColumns: '54px repeat(5, minmax(0, 1fr))' }}>
              <div />
              {DAYS.map((day, di) => (<div key={di} className={cx('mb-3 rounded-lg px-2 py-2 text-center text-sm font-700', di === t.todayIdx ? 'bg-brand text-white' : 'text-ink')}>{day}{di === t.todayIdx && <span className="ml-1 text-[11px] font-500 text-white/70">azi</span>}</div>))}
              <div className="relative font-mono text-[11px] text-muted" style={{ height: H }}>
                {hours.map((h) => (<div key={h} className="absolute right-1.5" style={{ top: (h - start) * PX - 6 }}>{fmtH(h)}</div>))}
              </div>
              {t.schedule.map((day, di) => (
                <div key={di} className={cx('relative rounded-lg border-l border-line', di === t.todayIdx && 'bg-brand-50/40')} style={{ height: H }}>
                  {hours.map((h) => (<div key={h} className="pointer-events-none absolute inset-x-0 border-t border-line/60" style={{ top: (h - start) * PX }} />))}
                  {day.map((s, i) => {
                    const top = (toMin(s.time) - start) * PX, height = Math.max(36, (toMin(s.end) - toMin(s.time)) * PX - 3);
                    return (
                      <motion.button key={i} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + di * 0.04 + i * 0.03, ...spring }}
                        onClick={() => setChanging(s)} aria-label={`${s.subjectName}, ${s.className}, ${s.time}`}
                        className="group absolute inset-x-1 overflow-hidden rounded-lg p-1.5 text-left transition-shadow hover:shadow-pill"
                        style={{ top, height, background: `color-mix(in oklab, ${s.hue} 14%, #fff)`, boxShadow: 'inset 0 1px 0 var(--glint)', borderLeft: `3px solid ${s.hue}` }}>
                        <div className="font-mono text-[10px] font-500" style={{ color: 'var(--color-ink-2)' }}>{s.time}</div>
                        <div className="truncate text-[12px] font-700 leading-tight">{s.subjectName}</div>
                        <div className="truncate text-[10.5px] text-muted">{s.className}{s.room ? `, ${s.room}` : ''}</div>
                      </motion.button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>}
      <Sheet open={!!changing} onClose={() => setChanging(null)} labelledBy="lc-t">
        {changing && <LessonChangeForm lesson={changing} colleagues={t.colleagues} onClose={() => setChanging(null)} onSaved={() => { setChanging(null); reload(); }} />}
      </Sheet>
    </div>
  );
}
/* ---------------- teacher catalog ---------------- */
function PickChips({ label, options, value, onChange }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2"><span className="text-[12px] font-700 text-muted">{label}:</span>
      {options.map((o) => <button key={o.id} onClick={() => onChange(o.id)} className={cx('rounded-lg px-3 py-2 text-[13px] font-700 ring-1', value === o.id ? 'bg-brand text-white ring-brand' : 'bg-white text-ink ring-line hover:bg-paper')}>{o.label}</button>)}
    </div>
  );
}
function TeacherCatalog({ t }) {
  // Start on today's first lesson, when there is one.
  const lesson = t.todayIdx != null ? t.schedule[t.todayIdx][0] : null;
  const firstClass = lesson ? t.classes.find((c) => c.id === lesson.classId) : t.classes[0];
  const [classId, setClassId] = useState(firstClass ? firstClass.id : null);
  const cls = t.classes.find((c) => c.id === classId);
  const [subject, setSubject] = useState(lesson ? lesson.subject : (firstClass ? firstClass.subjects[0] : null));
  const [mode, setMode] = useState('list');
  const [cat, setCat] = useState(null);
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [motivariTick, setMotivariTick] = useState(0);
  const load = useCallback(() => {
    if (!classId || !subject) return Promise.resolve();
    return API.get(`/api/teacher/catalog?classId=${classId}&subject=${encodeURIComponent(subject)}`).then((d) => { setErr(null); setCat(d); }).catch((e) => setErr(errText(e)));
  }, [classId, subject]);
  useEffect(() => { load(); }, [load]);
  const reloadAll = () => { setMotivariTick((n) => n + 1); return load(); };
  const pickClass = (id) => { setCat(null); setClassId(id); setSubject(t.classes.find((c) => c.id === id).subjects[0]); };
  const pickSubject = (code) => { setCat(null); setSubject(code); };
  const current = cat && cat.classId === classId && cat.subject === subject ? cat : null;
  const students = current ? [...current.students].sort(byFamily) : [];
  const open = students.find((s) => s.id === openId);
  const subjectName = (code) => (t.subjectCatalog.find((s) => s.code === code) || {}).name || code;
  return (
    <div>
      <ViewHead title="Catalog" sub="Note și absențe la clasele tale" icon={<Icons.chart />} />
      {t.classes.length === 0 ? <Empty icon={<Icons.chart size={26} />} title="Nicio clasă" body="Vei putea pune note după ce administratorul te adaugă în orar." />
        : <>
            <PickChips label="Clasa" options={t.classes.map((c) => ({ id: c.id, label: c.name }))} value={classId} onChange={pickClass} />
            {cls && <PickChips label="Materia" options={cls.subjects.map((code) => ({ id: code, label: subjectName(code) }))} value={subject} onChange={pickSubject} />}
            <div className="mb-4 overflow-x-auto no-scrollbar"><FluidTabs id="tcat" active={mode} onChange={setMode} tabs={[{ id: 'list', label: 'Elevi', icon: <Icons.users size={15} /> }, { id: 'roll', label: 'Prezența de azi', icon: <Icons.check size={15} /> }]} /></div>
            {err && <div className="mb-4"><LoadFailed err={err} retry={load} /></div>}
            {!current && !err && <div className="p-6 text-muted"><Spinner size={16} /> …</div>}
            {current && students.length === 0 && <Empty icon={<Icons.users size={26} />} title="Niciun elev" body="Clasa nu are încă elevi." />}
            {current && students.length > 0 && (mode === 'list'
              ? <CatalogTable key={classId} students={students} onOpen={setOpenId} modules={current.modules} />
              : <RollCall key={`${classId}-${subject}`} cat={current} students={students} reload={reloadAll} />)}
          </>}
      {t.homerooms.length > 0 && <Motivari tick={motivariTick} onChanged={reloadAll} />}
      <Sheet open={!!open} onClose={() => setOpenId(null)} labelledBy="se-t">
        {open && <StudentEntries key={open.id} student={open} cat={current} reload={reloadAll} onClose={() => setOpenId(null)} />}
      </Sheet>
    </div>
  );
}
const isAtRisk = (s) => s.avg !== null && s.avg < 5.5; // rounds below 6 (x.50 rounds up)
function SortHeader({ label, dir, onClick, right }) {
  return (
    <button type="button" onClick={onClick} className={cx('inline-flex items-center gap-1 text-[12px] font-700 hover:text-ink', dir ? 'text-ink' : 'text-muted', right && 'flex-row-reverse')}>
      {label}<Icons.chevD size={14} className={cx('transition-transform', dir === 'asc' && 'rotate-180', !dir && 'opacity-30')} />
    </button>
  );
}
function RiskTag() { return <span className="rounded-md bg-heat-heavy px-1.5 py-0.5 text-[11px] font-700 leading-none text-white">risc</span>; }
function Avg({ s }) { return <span className="font-display text-lg font-700 tnum" style={{ color: isAtRisk(s) ? '#D92626' : '#12201E' }}>{s.avg === null ? '—' : s.avg.toFixed(2)}</span>; }
function GradeList({ s }) { return s.grades.map((g) => <span key={g.id} className="grid h-7 w-7 place-items-center rounded-lg text-[13px] font-700 tnum" style={gradeStyle(g.v)}>{g.v}</span>); }
function AbsenceTag({ s }) { return s.absences.length > 0 && <span className="whitespace-nowrap rounded-lg bg-heat-heavybg px-2 py-0.5 text-[12px] font-700 text-heat-heavy tnum">{absentaLabel(s.absences.length)}</span>; }
// After Watermelon's sortable Data Table: a table from sm up, cards on phones.
function CatalogTable({ students: all, onOpen, modules }) {
  const [mod, setMod] = useState(0);
  const students = mod === 0 ? all : all.map((s) => {
    const grades = s.grades.filter((g) => g.module === mod);
    return { ...s, grades, avg: grades.length ? grades.reduce((n, g) => n + g.v, 0) / grades.length : null };
  });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' });
  const needle = plainText(q.trim());
  const rows = students.filter((s) => plainText(s.name).includes(needle)).sort((x, y) => {
    if (sort.col === 'avg') {
      if (x.avg === null || y.avg === null) return x.avg === null ? (y.avg === null ? 0 : 1) : -1; // no grades yet: always last
      if (x.avg !== y.avg) return sort.dir === 'asc' ? x.avg - y.avg : y.avg - x.avg;
    }
    return (sort.col === 'name' && sort.dir === 'desc' ? -1 : 1) * byFamily(x, y);
  });
  const toggle = (col) => setSort((c) => (c.col === col ? { col, dir: c.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  const dirOf = (col) => (sort.col === col ? sort.dir : null);
  const ariaSort = (col) => (sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  return (
    <div>
      <PickChips label="Perioada" options={[{ id: 0, label: 'Tot anul' }, ...modules.map((n) => ({ id: n, label: `M${n}` }))]} value={mod} onChange={setMod} />
      <label className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-white px-3 focus-within:border-brand">
        <Icons.search size={16} className="shrink-0 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută un elev după nume…" aria-label="Caută un elev după nume" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" />
      </label>
      {rows.length === 0 ? <p className="rounded-xl2 border border-line bg-white p-6 text-center text-[13px] text-muted">Niciun elev găsit.</p> : <>
        <div className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card sm:hidden">
          <div className="flex items-center justify-between border-b border-line bg-paper/60 px-4 py-2.5"><SortHeader label="Nume" dir={dirOf('name')} onClick={() => toggle('name')} /><SortHeader label="Medie" dir={dirOf('avg')} onClick={() => toggle('avg')} right /></div>
          {rows.map((s, i) => (
            <button key={s.id} onClick={() => onOpen(s.id)} className={cx('block w-full p-4 text-left', i && 'border-t border-line', isAtRisk(s) ? 'bg-heat-heavybg/50' : 'hover:bg-paper/60')}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2"><span className="min-w-0 truncate font-700">{s.name}</span>{isAtRisk(s) && <RiskTag />}</span>
                <Avg s={s} />
              </div>
              {(s.grades.length > 0 || s.absences.length > 0) && <div className="mt-2 flex flex-wrap items-center gap-1.5"><GradeList s={s} /><AbsenceTag s={s} /></div>}
            </button>
          ))}
        </div>
        <div className="hidden overflow-hidden rounded-xl2 border border-line bg-white shadow-card sm:block">
          <table className="w-full text-left">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th aria-sort={ariaSort('name')} className="px-4 py-2.5"><SortHeader label="Nume" dir={dirOf('name')} onClick={() => toggle('name')} /></th>
                <th className="px-4 py-2.5 text-[12px] font-700 text-muted">Note</th>
                <th className="px-4 py-2.5 text-[12px] font-700 text-muted">Absențe</th>
                <th aria-sort={ariaSort('avg')} className="px-4 py-2.5 text-right"><SortHeader label="Medie" dir={dirOf('avg')} onClick={() => toggle('avg')} right /></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.id} onClick={() => onOpen(s.id)} className={cx('cursor-pointer', i && 'border-t border-line', isAtRisk(s) ? 'bg-heat-heavybg/50' : 'hover:bg-paper/60')}>
                  <td className="px-4 py-3"><span className="flex items-center gap-2"><button onClick={(e) => { e.stopPropagation(); onOpen(s.id); }} className="text-left font-700 hover:underline">{s.name}</button>{isAtRisk(s) && <RiskTag />}</span></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5"><GradeList s={s} /></div></td>
                  <td className="px-4 py-3"><AbsenceTag s={s} /></td>
                  <td className="px-4 py-3 text-right"><Avg s={s} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}
function RollCall({ cat, students, reload }) {
  const [absent, setAbsent] = useState([]);
  const [busy, setBusy] = useState(false);
  if (!cat.lessonToday) return <Empty icon={<Icons.calendar size={26} />} title="Nicio oră azi" body={`Azi nu ai ${cat.subjectName} la ${cat.className}. Alege altă materie sau adaugă absența din lista de elevi.`} />;
  const marked = (s) => s.absences.some((a) => a.d === cat.today);
  const toggle = (id) => { setAbsent((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); };
  const save = () => {
    setBusy(true);
    API.post('/api/absences', { studentIds: absent, subject: cat.subject, date: cat.today })
      .then((r) => reload().then(() => { setAbsent([]); toast.success(`Am salvat ${absentaLabel(r.added)}.`); }))
      .catch(toastError)
      .finally(() => setBusy(false));
  };
  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">{cat.subjectName} · {cat.className} · ora {cat.lessonToday}. Atinge numele elevilor absenți, apoi salvează.</p>
      <ul className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card">
        {students.map((s, i) => {
          const done = marked(s), on = absent.includes(s.id);
          return (
            <li key={s.id} className={cx(i && 'border-t border-line')}>
              <button disabled={done} aria-pressed={on || done} onClick={() => toggle(s.id)} className={cx('flex w-full items-center gap-3 p-4 text-left transition-colors', on ? 'bg-heat-heavybg' : !done && 'hover:bg-paper/60')}>
                <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-md border-2', on || done ? 'border-heat-heavy bg-heat-heavy text-white' : 'border-line')}>{(on || done) && <Icons.x size={14} sw={3} />}</span>
                <span className={cx('min-w-0 flex-1 truncate font-700', done && 'text-muted')}>{s.name}</span>
                {done ? <span className="shrink-0 text-[12px] font-600 text-muted">absent, salvat</span> : on && <span className="shrink-0 text-[12px] font-700 text-heat-heavy">absent</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-20 z-20 mt-4 lg:bottom-4">
        <ShimmerButton className="w-full" onClick={save} disabled={busy || absent.length === 0}>{busy ? 'Se salvează…' : absent.length ? `Salvează (${absentaLabel(absent.length)})` : 'Salvează'}</ShimmerButton>
      </div>
    </div>
  );
}
function StudentEntries({ student, cat, reload, onClose }) {
  const [tab, setTab] = useState('grade');
  const [editing, setEditing] = useState(null); // id of the entry being edited
  const [value, setValue] = useState(8);
  const [date, setDate] = useState(cat.today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const clear = () => { setEditing(null); setValue(8); setDate(cat.today); setNote(''); };
  const run = (promise, done) => {
    setBusy(true);
    return promise.then(() => { clear(); toast.success(done); return reload(); }).catch(toastError).finally(() => setBusy(false));
  };
  const switchTab = (id) => { clear(); setTab(id); };
  const saveGrade = () => run(editing
    ? API.patch(`/api/grades/${editing}`, { value, date, note })
    : API.post('/api/grades', { studentId: student.id, subject: cat.subject, value, date, note }), editing ? 'Nota a fost modificată.' : 'Nota a fost adăugată.');
  const saveAbsence = () => run(editing
    ? API.patch(`/api/absences/${editing}`, { date })
    : API.post('/api/absences', { studentId: student.id, subject: cat.subject, date }), editing ? 'Absența a fost modificată.' : 'Absența a fost adăugată.');
  const editGrade = (g) => { setTab('grade'); setEditing(g.id); setValue(g.v); setDate(g.d); setNote(g.note || ''); };
  const editAbsence = (a) => { setTab('absence'); setEditing(a.id); setDate(a.d); };
  const delGrade = async (g) => {
    if (await askConfirm({ title: `Ștergi nota ${g.v} din ${fmtDate(g.d)}?`, body: `Nota lui ${student.name} la ${cat.subjectName} va dispărea din catalog.`, action: 'Șterge nota' })) run(API.del(`/api/grades/${g.id}`), 'Nota a fost ștearsă.');
  };
  const delAbsence = async (a) => {
    if (await askConfirm({ title: `Ștergi absența din ${fmtDate(a.d)}?`, body: `Absența lui ${student.name} la ${cat.subjectName} va dispărea din catalog.`, action: 'Șterge absența' })) run(API.del(`/api/absences/${a.id}`), 'Absența a fost ștearsă.');
  };
  const iconBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-paper hover:text-ink';
  return (
    <Modal>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 id="se-t" className="truncate font-display text-xl font-700">{student.name}</h3><p className="text-sm text-muted">{cat.subjectName} · {cat.className}{student.avg !== null && ` · media ${student.avg.toFixed(2)}`}</p></div>
        <button onClick={onClose} aria-label="Închide" className={iconBtn}><Icons.x size={18} /></button>
      </div>
      <div className="mt-4"><FluidTabs id="entry" active={tab} onChange={switchTab} tabs={[{ id: 'grade', label: 'Notă', icon: <Icons.chart size={15} /> }, { id: 'absence', label: 'Absență', icon: <Icons.calendar size={15} /> }]} /></div>
      <div className="mt-4 space-y-4">
        {tab === 'grade' && <div><span className="mb-1 block text-[12px] font-700 text-muted">Nota</span><Stepper value={value} set={setValue} /></div>}
        <Field label="Data"><Input type="date" value={date} max={cat.today} onChange={(e) => setDate(e.target.value)} /></Field>
        {tab === 'grade' && <div>
          <Field label="Observație (opțional)"><Input value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder="ex. lucrare" /></Field>
          <div className="mt-2 flex flex-wrap gap-1.5">{['lucrare', 'ascultare', 'temă'].map((n) => <button key={n} type="button" onClick={() => setNote(n)} className={cx('rounded-lg px-2.5 py-1.5 text-[13px] font-700 ring-1', note === n ? 'bg-brand text-white ring-brand' : 'bg-white text-ink ring-line hover:bg-paper')}>{n}</button>)}</div>
        </div>}
      </div>
      <div className="mt-5 flex gap-2">
        <ShimmerButton className="flex-1" disabled={busy} onClick={tab === 'grade' ? saveGrade : saveAbsence}>{editing ? 'Salvează modificarea' : tab === 'grade' ? 'Adaugă nota' : 'Adaugă absența'}</ShimmerButton>
        {editing && <button onClick={clear} className="rounded-xl border border-line px-4 font-700 text-muted hover:bg-paper">Renunță</button>}
      </div>
      {student.grades.length > 0 && <div className="mt-6">
        <h4 className="mb-1 text-[12px] font-700 text-muted">Note</h4>
        <ul>{student.grades.map((g) => (
          <li key={g.id} className="flex items-center gap-2 border-t border-line py-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-700 tnum" style={gradeStyle(g.v)}>{g.v}</span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{fmtDate(g.d)}{g.note && ` · ${g.note}`}{!g.mine && g.teacher && <span className="text-muted"> · {g.teacher}</span>}</span>
            {g.mine && <><button onClick={() => editGrade(g)} aria-label={`Modifică nota ${g.v}`} className={iconBtn}><Icons.pencil size={16} /></button><button onClick={() => delGrade(g)} aria-label={`Șterge nota ${g.v}`} className={iconBtn}><Icons.trash size={16} /></button></>}
          </li>
        ))}</ul>
      </div>}
      {student.absences.length > 0 && <div className="mt-5">
        <h4 className="mb-1 text-[12px] font-700 text-muted">Absențe</h4>
        <ul>{student.absences.map((a) => (
          <li key={a.id} className="flex items-center gap-2 border-t border-line py-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px]">{fmtDate(a.d)} · <span className={a.excused ? 'text-heat-calm' : 'text-heat-heavy'}>{a.excused ? 'motivată' : 'nemotivată'}</span>{!a.mine && a.teacher && <span className="text-muted"> · {a.teacher}</span>}</span>
            {!a.excused && (a.mine || cat.isHomeroom) && <button onClick={() => run(API.patch(`/api/absences/${a.id}`, { excused: true }), 'Absența a fost motivată.')} className="shrink-0 rounded-lg px-2 py-2 text-[12.5px] font-700 text-brand hover:bg-brand-50">Motivează</button>}
            {a.mine && <><button onClick={() => editAbsence(a)} aria-label="Modifică absența" className={iconBtn}><Icons.pencil size={16} /></button><button onClick={() => delAbsence(a)} aria-label="Șterge absența" className={iconBtn}><Icons.trash size={16} /></button></>}
          </li>
        ))}</ul>
      </div>}
    </Modal>
  );
}
function Motivari({ tick, onChanged }) {
  const [m, setM] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => API.get('/api/teacher/motivari').then((d) => { setErr(null); setM(d); }).catch((e) => setErr(errText(e))), []);
  useEffect(() => { load(); }, [load, tick]);
  const excuse = (a) => API.patch(`/api/absences/${a.id}`, { excused: true }).then(() => { toast.success('Absența a fost motivată.'); return onChanged(); }).catch(toastError);
  return (
    <section className="mt-6">
      <h2 className="mb-3 font-display text-lg font-700">Motivări</h2>
      {err && <div className="mb-3"><LoadFailed err={err} retry={load} /></div>}
      {m && m.classes.map((c) => (
        <div key={c.classId} className="mb-3 overflow-hidden rounded-xl2 border border-line bg-white shadow-card">
          <p className="border-b border-line p-3 text-[13px] font-700 text-muted">Dirigenție · {c.className}</p>
          {c.absences.length === 0 ? <p className="p-4 text-center text-[13px] text-muted">Nicio absență nemotivată.</p>
            : c.absences.map((a, i) => (
              <div key={a.id} className={cx('flex items-center gap-3 p-3.5', i && 'border-t border-line')}>
                <div className="min-w-0 flex-1"><p className="truncate font-700">{a.student}</p><p className="truncate text-[12.5px] text-muted">{fmtDate(a.d)} · {a.short}{a.teacher && ` · ${a.teacher}`}</p></div>
                <button onClick={() => excuse(a)} className="shrink-0 rounded-lg bg-brand-50 px-3 py-2 text-[13px] font-700 text-brand-600 hover:bg-brand-100">Motivează</button>
              </div>
            ))}
        </div>
      ))}
    </section>
  );
}

function TeacherWorkload({ t }) {
  const [classId, setClassId] = useState(t.classes[0] ? t.classes[0].id : null);
  const [wl, setWl] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [err, setErr] = useState(null);
  const current = useRef(classId); current.current = classId;
  const load = useCallback(() => { if (classId) return API.get(`/api/teacher/workload?classId=${classId}`).then((d) => { if (current.current === classId) { setErr(null); setWl(d); } }).catch((e) => { if (current.current === classId) setErr(errText(e)); }); }, [classId]);
  useEffect(() => { setWl(null); setErr(null); load(); }, [load]); // never show the previous class's map under the new name
  const removeTest = async (it, day) => {
    if (!await askConfirm({ title: `Ștergi „${it.title}”?`, body: `${it.short}, ${day.dateLabel}. Elevii nu o vor mai vedea, iar notificarea ei dispare.`, action: 'Șterge evaluarea' })) return;
    API.del(`/api/assessments/${it.id}`).then(() => { toast.success('Evaluarea a fost ștearsă.'); return load(); }).catch(toastError);
  };
  if (t.classes.length === 0) return <div><ViewHead title="Încărcare" sub="Harta evaluărilor pe clasă" icon={<Icons.pulse />} /><Empty icon={<Icons.pulse size={26} />} title="Nicio clasă" body="Vei vedea harta de încărcare după ce ai ore în orar." /></div>;
  const myClass = t.classes.find((c) => c.id === classId);
  return (
    <div>
      <ViewHead title="Încărcare" icon={<Icons.pulse />} sub="Vezi cât de plină e săptămâna clasei înainte să programezi o evaluare"
        right={<ShimmerButton icon={<Icons.plus size={18} />} onClick={() => setAddOpen(true)} className="hidden sm:inline-flex">Programează o lucrare</ShimmerButton>} />
      {t.classes.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2"><span className="text-[12px] font-700 text-muted">Clasa:</span>
          {t.classes.map((c) => <button key={c.id} onClick={() => setClassId(c.id)} className={cx('rounded-lg px-3 py-1.5 text-[13px] font-700 ring-1', classId === c.id ? 'bg-brand text-white ring-brand' : 'bg-white text-ink ring-line hover:bg-paper')}>{c.name}</button>)}
        </div>
      )}
      {!err && wl && wl.collisions.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl2 border border-heat-heavy/25 bg-heat-heavybg/60 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-heat-heavy shadow-sm"><Icons.alert size={18} /></span>
          <div className="text-sm"><p className="font-700 text-heat-heavy">Coliziune de evaluări în {myClass.name}</p>
            {wl.collisions.map((c, i) => c.kind === 'window'
              ? <p key={i} className="mt-0.5 text-ink/75"><b>{c.dateLabel}</b>: {c.items.length} evaluări în 48 de ore — {c.items.map((x) => `${x.short} (${(TYPE_LABEL[x.type] || 'evaluare').toLowerCase()}, ${x.dateLabel})`).join(' + ')}. Ia în calcul o altă zi.</p>
              : <p key={i} className="mt-0.5 text-ink/75"><b>{c.dateLabel}</b>: {c.items.map((x) => `${x.short} (${(TYPE_LABEL[x.type] || 'evaluare').toLowerCase()})`).join(' + ')}. Ia în calcul o altă zi.</p>)}
          </div>
        </div>
      )}
      {err ? <LoadFailed err={err} retry={load} /> : wl ? <Heatmap wl={wl} typeLabel={TYPE_LABEL} canDelete={(it) => it.teacherId === t.teacher.id} onDelete={removeTest} /> : <div className="p-6 text-muted"><Spinner size={16} /> …</div>}
      {wl && <p className="mt-2 text-[12px] text-muted">Atinge o evaluare pusă de tine ca să o ștergi.</p>}
      <ShimmerButton icon={<Icons.plus size={18} />} onClick={() => setAddOpen(true)} className="mt-4 w-full sm:hidden">Programează o lucrare</ShimmerButton>
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} labelledBy="a-t">
        {addOpen && <ScheduleTest t={t} classId={classId} className={myClass.name} suggestions={wl ? wl.suggestions : []} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} />}
      </Sheet>
    </div>
  );
}
const DICTATE_ERRORS = {
  'not-allowed': 'Browserul nu are voie să folosească microfonul. Permite accesul din setările site-ului.',
  'service-not-allowed': 'Browserul nu are voie să folosească microfonul. Permite accesul din setările site-ului.',
  'audio-capture': 'Nu am găsit niciun microfon.',
  'no-speech': 'Nu am auzit nimic. Încearcă din nou.',
  network: 'Dictarea are nevoie de internet.',
};
// Speech-to-text in Romanian, through the browser's own speech service. Hidden where unsupported.
function DictateButton({ onText, onError }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const [listening, setListening] = useState(false);
  const active = useRef(null);
  useEffect(() => () => { if (active.current) active.current.abort(); }, []);
  if (!Recognition) return null;
  const toggle = () => {
    if (active.current) return active.current.stop();
    const rec = new Recognition();
    rec.lang = 'ro-RO';
    rec.onresult = (e) => { const text = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim(); if (text) onText(text); };
    rec.onerror = (e) => { if (e.error !== 'aborted') onError(DICTATE_ERRORS[e.error] || 'Dictarea nu a funcționat. Încearcă din nou.'); };
    rec.onend = () => { active.current = null; setListening(false); };
    onError(null);
    active.current = rec;
    setListening(true);
    rec.start();
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={listening} aria-label={listening ? 'Oprește dictarea' : 'Dictează titlul'} title={listening ? 'Oprește dictarea' : 'Dictează titlul'}
      className={cx('grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border transition-colors', listening ? 'border-brand bg-brand text-white' : 'border-line bg-white text-muted hover:bg-paper hover:text-ink')}>
      <Icons.mic size={18} />
    </button>
  );
}
function ScheduleTest({ t, classId, className, suggestions, onClose, onSaved }) {
  const taught = (t.classes.find((c) => c.id === classId) || {}).subjects || []; // what they teach in THIS class, per the timetable
  const mySubs = t.subjectCatalog.filter((s) => taught.includes(s.code));
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState(mySubs[0] ? mySubs[0].code : '');
  const [type, setType] = useState('test');
  const [dateISO, setDateISO] = useState('');
  const [title, setTitle] = useState('');
  const [dictateErr, setDictateErr] = useState(null);
  const addDictated = (text) => setTitle((v) => (v.trim() ? `${v.trim()} ${text}` : text.charAt(0).toUpperCase() + text.slice(1)));
  const save = () => {
    if (!subject) return toast.error('Alege materia.');
    if (!dateISO) return toast.error('Alege data.');
    setBusy(true);
    API.post('/api/assessments', { classId, subject, type, date: dateISO, title: title || TYPE_LABEL[type] })
      .then(() => { toast.success(`${TYPE_LABEL[type]} programată.`); onSaved(); }).catch(toastError).finally(() => setBusy(false));
  };
  return (
    <Modal>
      <h3 id="a-t" className="font-display text-xl font-700">Programează o evaluare · {className}</h3>
      <p className="mt-1 text-sm text-muted">SchoolPilot îți arată zilele cele mai libere ale clasei.</p>
      <div className="mt-4 space-y-4">
        <Field label="Materie"><SubjectSelect subjects={mySubs} value={subject} onChange={setSubject} /></Field>
        <div><span className="mb-1 block text-[12px] font-700 text-muted">Tip</span>
          <div className="flex gap-1.5">{['test', 'quiz', 'tema'].map((k) => <button key={k} onClick={() => setType(k)} className={cx('flex-1 rounded-lg px-2 py-2 text-[13px] font-700 ring-1', type === k ? 'bg-brand text-white ring-brand' : 'bg-white text-ink ring-line hover:bg-paper')}>{TYPE_LABEL[k]}</button>)}</div>
        </div>
        {suggestions.length > 0 && <div><span className="mb-1.5 block text-[12px] font-700 text-heat-calm">Zile recomandate (clasa e cel mai liberă)</span>
          <div className="flex flex-wrap gap-1.5">{suggestions.map((d) => { const h = HEAT[d.heat.k]; return <button key={d.date} onClick={() => setDateISO(d.date)} className={cx('rounded-lg px-2.5 py-1.5 text-[13px] font-700 ring-1', dateISO === d.date ? 'ring-brand' : 'ring-transparent')} style={{ background: h.bg, color: h.fg }}>{d.dateLabel}</button>; })}</div>
        </div>}
        <Field label="Data"><Input type="date" value={dateISO} min={todayISO()} onChange={(e) => setDateISO(e.target.value)} /></Field>
        <Field label="Titlu (opțional)">
          <div className="flex items-center gap-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Lucrare — funcții" /><DictateButton onText={addDictated} onError={setDictateErr} /></div>
          {dictateErr && <p role="alert" className="mt-1 text-[12px] text-heat-heavy">{dictateErr}</p>}
        </Field>
      </div>
      <div className="mt-5 flex gap-2"><ShimmerButton className="flex-1" disabled={busy} onClick={save}>{busy ? 'Se programează…' : 'Programează'}</ShimmerButton><button onClick={onClose} className="rounded-xl border border-line px-4 font-700 text-muted hover:bg-paper">Anulează</button></div>
    </Modal>
  );
}

/* =====================================================================
 *  STUDENT
 * ===================================================================== */
function StudentApp({ account, onLogout }) {
  const [view, setView] = useState('today');
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => API.get('/api/student').then((d) => { setErr(null); setS(d); }).catch((e) => setErr(errText(e))), [account.id]);
  useEffect(() => { load(); const poll = setInterval(load, 60000); return () => clearInterval(poll); }, [load]);
  const nav = [{ id: 'today', label: 'Azi', icon: Icons.sun }, { id: 'timetable', label: 'Orar', icon: Icons.grid }, { id: 'marks', label: 'Catalog', icon: Icons.chart }, { id: 'announcements', label: 'Anunțuri', icon: Icons.megaphone }, { id: 'messages', label: 'Mesaje', icon: Icons.message, badge: s ? s.unreadMessages : 0 }, { id: 'notifications', label: 'Notificări', icon: Icons.bell, badge: s ? s.unread : 0 }];
  return (
    <Shell account={account} nav={nav} view={view} setView={setView} onLogout={onLogout}>
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
        {!s ? (err ? <LoadFailed err={err} retry={load} /> : <div className="p-10 text-muted"><Spinner size={18} /> Se încarcă…</div>)
          : view === 'today' ? <StudentToday s={s} reload={load} onGoto={setView} />
          : view === 'timetable' ? <StudentTimetable s={s} />
          : view === 'notifications' ? <StudentNotifications onRead={load} onGoto={setView} />
          : view === 'announcements' ? <Announcements markRead />
          : view === 'messages' ? <Messages student onRead={load} upcoming={s.upcoming} />
          : <StudentMarks s={s} reload={load} />}
      </div>
    </Shell>
  );
}
/* =====================================================================
 *  ANNOUNCEMENTS, shared by all three roles
 * ===================================================================== */
const ANNOUNCEMENT_PRIORITY = {
  urgent: { label: 'Urgent', tone: 'bg-heat-heavy text-white' },
  normal: { label: 'Normal', tone: 'bg-paper text-muted' },
  info: { label: 'Info', tone: 'bg-brand-50 text-brand-600' },
};
const announcementTarget = (a) => [a.className || 'Toată școala', a.subjectName].filter(Boolean).join(' · ');
const stamp = (iso) => `${fmtDate(iso.slice(0, 10))}, ${iso.slice(11, 16)}`;
function AnnouncementCard({ a, onDelete }) {
  const p = ANNOUNCEMENT_PRIORITY[a.priority] || ANNOUNCEMENT_PRIORITY.normal;
  return (
    <article className={cx('rounded-xl2 border bg-white p-4 shadow-card', a.priority === 'urgent' ? 'border-heat-heavy/40' : 'border-line')} style={a.priority === 'urgent' ? { borderLeft: '3px solid #D92626' } : undefined}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {a.priority !== 'normal' && <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-700 leading-none', p.tone)}>{p.label}</span>}
            <span className="text-[12px] font-700 text-muted">{announcementTarget(a)}</span>
            {a.read === false && <span className="h-2 w-2 rounded-full bg-brand" aria-label="necitit" />}
          </div>
          <h3 className="font-display text-[17px] font-700 leading-snug">{a.title}</h3>
        </div>
        {a.canDelete && <button onClick={() => onDelete(a)} aria-label={`Șterge anunțul ${a.title}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-heat-heavybg hover:text-heat-heavy"><Icons.trash size={16} /></button>}
      </div>
      {a.body && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{a.body}</p>}
      {a.link && <a href={a.link} target="_blank" rel="noopener noreferrer" className="mt-1.5 block truncate text-sm font-700 text-brand-600 underline">{a.link}</a>}
      <p className="mt-2 text-[12px] text-muted">{a.author && `${a.author} · `}{stamp(a.createdAt)}{a.total !== undefined && ` · văzut de ${a.seen} din ${a.total}`}</p>
    </article>
  );
}
function AnnouncementForm({ school, targets, onClose, onSaved }) {
  const options = school ? [{ id: 0, name: 'Toată școala', subjects: [] }, ...school.classes.map((c) => ({ id: c.id, name: c.name, subjects: [] }))] : targets;
  const [target, setTarget] = useState(options[0].id);
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState('normal');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [dictateErr, setDictateErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const chosen = options.find((o) => o.id === target);
  const pickTarget = (id) => { setTarget(id); setSubject(''); };
  const addDictated = (spoken) => setTitle((v) => (v.trim() ? `${v.trim()} ${spoken}` : spoken.charAt(0).toUpperCase() + spoken.slice(1)));
  const save = () => {
    if (!title.trim()) return toast.error('Scrie un titlu.');
    setBusy(true);
    API.post('/api/announcements', { schoolId: school ? school.id : undefined, classId: target || null, subject: subject || null, priority, title, body: text, link })
      .then(() => { toast.success('Anunțul a fost publicat.'); onSaved(); })
      .catch(toastError).finally(() => setBusy(false));
  };
  return (
    <Modal>
      <h3 id="an-t" className="font-display text-xl font-700">Anunț nou</h3>
      <div className="mt-4">
        <PickChips label="Pentru" options={options.map((o) => ({ id: o.id, label: o.name }))} value={target} onChange={pickTarget} />
        {chosen.subjects.length > 0 && <PickChips label="Materia" options={[{ id: '', label: 'Toată clasa' }, ...chosen.subjects]} value={subject} onChange={setSubject} />}
        <PickChips label="Prioritate" options={PRIORITY_CHOICES} value={priority} onChange={setPriority} />
      </div>
      <div className="mt-1 space-y-4">
        <Field label="Titlu">
          <div className="flex items-center gap-2"><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Excursie la muzeu vineri" /><DictateButton onText={addDictated} onError={setDictateErr} /></div>
          {dictateErr && <p role="alert" className="mt-1 text-[12px] text-heat-heavy">{dictateErr}</p>}
        </Field>
        <Field label="Text (opțional)"><textarea value={text} maxLength={2000} rows={4} onChange={(e) => setText(e.target.value)} placeholder="Detalii pentru elevi" className="w-full resize-y rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand" /></Field>
        <Field label="Link (opțional)"><Input type="url" value={link} maxLength={500} onChange={(e) => setLink(e.target.value)} placeholder="https://… fișă, PDF, formular" /></Field>
      </div>
      <div className="mt-5 flex gap-2"><ShimmerButton className="flex-1" disabled={busy} onClick={save}>{busy ? 'Se publică…' : 'Publică'}</ShimmerButton><button onClick={onClose} className="rounded-xl border border-line px-4 font-700 text-muted hover:bg-paper">Anulează</button></div>
    </Modal>
  );
}
const PRIORITY_CHOICES = ['normal', 'urgent', 'info'].map((id) => ({ id, label: ANNOUNCEMENT_PRIORITY[id].label }));
function SchoolEvents({ school, canPost }) {
  const url = school ? `/api/events?schoolId=${school.id}` : '/api/events';
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', date: '', kind: 'club', note: '' });
  const load = useCallback(() => API.get(url).then(setData).catch(toastError), [url]);
  useEffect(() => { load(); }, [load]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const [, once] = useBusy();
  const save = once(() => API.post('/api/events', { ...form, schoolId: school ? school.id : undefined }).then(() => {
    toast.success('Evenimentul a fost adăugat.'); setAdding(false); setForm({ title: '', date: '', kind: 'club', note: '' }); return load();
  }).catch(toastError));
  const del = async (e) => {
    if (!await askConfirm({ title: `Ștergi evenimentul „${e.title}”?`, body: 'Elevii nu îl vor mai vedea.', action: 'Șterge evenimentul' })) return;
    API.del(`/api/events/${e.id}`).then(() => { toast.success('Evenimentul a fost șters.'); return load(); }).catch(toastError);
  };
  if (!data) return null;
  if (!canPost && data.items.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-display text-lg font-700">Cluburi, olimpiade și termene</h2>{canPost && <button onClick={() => setAdding(true)} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-700 text-brand hover:text-brand-600"><Icons.plus size={14} /> adaugă</button>}</div>
      {data.items.length === 0 ? <p className="rounded-xl2 border border-line bg-white p-5 text-center text-[13px] text-muted">Niciun eveniment programat.</p>
        : <ul className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card">{data.items.map((e, i) => (
          <li key={e.id} className={cx('flex items-center gap-3 p-3.5', i && 'border-t border-line')}>
            <span className="w-14 shrink-0 text-[13px] font-700 tnum text-muted">{fmtDate(e.date)}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-700">{e.title}</span><span className="block text-[12.5px] text-muted">{e.kindLabel}{e.note && ` · ${e.note}`}</span></span>
            {e.canDelete && <button onClick={() => del(e)} aria-label={`Șterge ${e.title}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-heat-heavybg hover:text-heat-heavy"><Icons.trash size={16} /></button>}
          </li>
        ))}</ul>}
      <Sheet open={adding} onClose={() => setAdding(false)} labelledBy="ev-t">
        {adding && <Modal>
          <h3 id="ev-t" className="font-display text-xl font-700">Eveniment nou</h3>
          <div className="mt-4 space-y-4">
            <PickChips label="Tip" options={Object.entries(data.kinds).map(([id, label]) => ({ id, label }))} value={form.kind} onChange={(kind) => setForm((f) => ({ ...f, kind }))} />
            <Field label="Titlu"><Input value={form.title} maxLength={120} onChange={set('title')} placeholder="ex. Olimpiada de matematică" /></Field>
            <Field label="Data"><Input type="date" value={form.date} min={todayISO()} onChange={set('date')} /></Field>
            <Field label="Detalii (opțional)"><Input value={form.note} maxLength={300} onChange={set('note')} /></Field>
          </div>
          <div className="mt-5 flex gap-2"><ShimmerButton className="flex-1" onClick={save}>Adaugă</ShimmerButton><button onClick={() => setAdding(false)} className="rounded-xl border border-line px-4 font-700 text-muted hover:bg-paper">Renunță</button></div>
        </Modal>}
      </Sheet>
    </section>
  );
}
const MESSAGE_TEMPLATES = ['Aș dori o amânare pentru tema de la', 'Am o întrebare despre nota de la', 'Am lipsit și vreau să anunț motivul:', 'Nu am înțeles lecția despre'];
function Messages({ student, onRead, upcoming = [] }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [key, setKey] = useState(null);
  const [title, setTitle] = useState('');
  const load = useCallback(() => API.get('/api/messages').then((d) => { setErr(null); setData(d); }).catch((e) => setErr(errText(e))), []);
  useEffect(() => { load(); }, [load]);
  const open = (k, name) => { setKey(k); setTitle(name); };
  if (key) return <MessageThread threadKey={key} title={title} student={student} upcoming={upcoming} subjects={((data.contacts.find((c) => `user:${c.id}` === key)) || {}).subjects} quiet={data.quietHours} onOpened={onRead} onMoved={(k) => { setKey(k); setTitle('Întrebare anonimă'); load(); }} onBack={() => { setKey(null); load(); onRead(); }} />;
  const known = data ? data.threads.map((t) => t.key) : [];
  const others = data ? data.contacts.filter((c) => !known.includes(`user:${c.id}`)).sort(byFamily) : [];
  const contactOptions = others.map((c) => ({ value: String(c.id), label: c.name, hint: c.detail }));
  return (
    <div>
      <ViewHead title="Mesaje" sub={student ? 'Cu profesorii tăi' : 'Cu elevii tăi'} icon={<Icons.message />} />
      {err ? <LoadFailed err={err} retry={load} /> : !data ? <div className="p-10 text-muted"><Spinner size={18} /> Se încarcă…</div> : <>
        {others.length > 0 && <div className="mb-3"><SearchSelect label="Mesaj nou" value="" onChange={(id) => open(`user:${id}`, others.find((c) => String(c.id) === id).name)} placeholder="Mesaj nou…" searchPlaceholder={student ? 'Caută profesorul…' : 'Caută elevul…'} empty="Nimeni găsit." options={contactOptions} /></div>}
        {data.threads.length === 0 ? <Empty icon={<Icons.message size={26} />} title="Niciun mesaj" body={student ? 'Scrie-i unui profesor. Mesajele trimise noaptea ajung dimineața.' : 'Mesajele de la elevi apar aici.'} />
          : <ul className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card">{data.threads.map((t, i) => (
            <li key={t.key} className={cx(i && 'border-t border-line')}>
              <button onClick={() => open(t.key, t.name)} className={cx('flex w-full items-center gap-3 p-3.5 text-left hover:bg-paper/60', t.unread > 0 && 'bg-brand-50/50')}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper text-[13px] font-700 text-muted">{t.anonymous ? '?' : initials(t.name)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-700">{t.name}</span><span className="block truncate text-[12.5px] text-muted">{t.last}</span></span>
                {t.unread > 0 && <Badge n={t.unread} />}
              </button>
            </li>
          ))}</ul>}
      </>}
    </div>
  );
}
function MessageThread({ threadKey, title, student, upcoming, quiet, subjects, onOpened, onMoved, onBack }) {
  const anonThread = threadKey.startsWith('anon:');
  const [rows, setRows] = useState(null);
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const load = useCallback(() => API.get(`/api/messages/thread?key=${encodeURIComponent(threadKey)}`).then((d) => { setLoadErr(null); setRows(d.messages); }).catch((e) => setLoadErr(errText(e))), [threadKey]);
  useEffect(() => { load().then(() => onOpened && onOpened()); }, [load]); // the server marked them read: clear the badge now
  const send = () => {
    if (!text.trim()) return;
    setBusy(true);
    API.post('/api/messages', { thread: threadKey, body: text, anonymous }).then((r) => {
      setText(''); setAnonymous(false); if (r.delayed) toast.info('Îl va vedea dimineața, la ora 7.');
      if (r.thread && r.thread !== threadKey) { toast.success('Întrebarea anonimă are acum conversația ei.'); return onMoved && onMoved(r.thread); }
      return load();
    }).catch(toastError).finally(() => setBusy(false));
  };
  // only this teacher's subjects (when we know them): asking the maths teacher shouldn't suggest the history homework
  const answers = student && /când|cand|lucrare|test|tem[aă]|evaluare/i.test(text) ? upcoming.filter((u) => !subjects || subjects.includes(u.subject)).slice(0, 3) : [];
  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-700 text-muted hover:text-ink"><Icons.chevL size={16} /> Mesaje</button>
      <h1 className="mb-3 font-display text-2xl font-700 leading-tight">{title}</h1>
      {loadErr && !rows ? <LoadFailed err={loadErr} retry={load} />
        : !rows ? <div className="p-6 text-muted"><Spinner size={16} /> …</div>
        : rows.length === 0 ? <p className="mb-3 rounded-xl2 border border-line bg-white p-5 text-center text-[13px] text-muted">Începe conversația.</p>
        : <div className="mb-3 space-y-2">{rows.map((m) => (
          <div key={m.id} className={cx('flex', m.mine ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm', m.mine ? 'bg-brand text-white' : 'border border-line bg-white')}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={cx('mt-1 text-[11px]', m.mine ? 'text-white/75' : 'text-muted')}>{stamp(m.at)}{m.anonymous && ' · anonim'}{m.pending && ' · ajunge dimineața'}</p>
            </div>
          </div>
        ))}</div>}
      {answers.length > 0 && <div className="mb-3 rounded-xl border border-line bg-white p-3 text-[13px]"><p className="mb-1 font-700">Poate găsești răspunsul aici:</p><ul>{answers.map((u) => <li key={u.id}>{fmtDate(u.date)} · {u.title} ({u.subjectName})</li>)}</ul></div>}
      {student && text === '' && <div className="mb-2 flex flex-wrap gap-1.5">{MESSAGE_TEMPLATES.map((t) => <button key={t} onClick={() => setText(`${t} `)} className="rounded-lg bg-white px-2.5 py-1.5 text-left text-[12.5px] font-600 text-muted ring-1 ring-line hover:bg-paper">{t}</button>)}</div>}
      <textarea value={text} rows={3} maxLength={1000} onChange={(e) => setText(e.target.value)} aria-label="Mesaj" placeholder="Scrie un mesaj…" className="w-full resize-y rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand" />
      {student && anonThread && <p className="mt-1.5 text-[13px] text-muted">Conversație anonimă: profesorul nu vede cine scrie.</p>}
      {student && !anonThread && <label className="mt-1.5 flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Trimite anonim: profesorul nu vede cine întreabă</label>}
      <ShimmerButton className="mt-2 w-full" icon={<Icons.send size={16} />} disabled={busy || !text.trim()} onClick={send}>Trimite</ShimmerButton>
      {student && <p className="mt-2 text-center text-[12px] text-muted">Între {quiet[0]}:00 și {String(quiet[1]).padStart(2, '0')}:00, mesajele așteaptă până dimineața.</p>}
    </div>
  );
}
// Admin: pass `school`. Teacher: `canPost`. Student: `markRead`.
function Announcements({ school, canPost, markRead }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => API.get(school ? `/api/announcements?schoolId=${school.id}` : '/api/announcements').then((d) => {
    setErr(null); setData(d); // unread dots stay for this visit
    if (markRead && d.items.some((a) => !a.read)) API.post('/api/announcements/read', {}).catch(() => {});
  }).catch((e) => setErr(errText(e))), [school && school.id, markRead]);
  useEffect(() => { load(); }, [load]);
  const del = async (a) => {
    if (!await askConfirm({ title: `Ștergi anunțul „${a.title}”?`, body: 'Elevii nu îl vor mai vedea, iar notificarea lui dispare.', action: 'Șterge anunțul' })) return;
    API.del(`/api/announcements/${a.id}`).then(() => { toast.success('Anunțul a fost șters.'); return load(); }).catch(toastError);
  };
  const posting = school || (canPost && data && data.targets.length > 0);
  const addButton = posting && <ShimmerButton icon={<Icons.plus size={18} />} onClick={() => setAdding(true)}>Anunț nou</ShimmerButton>;
  return (
    <div>
      {school ? <div className="mb-4">{addButton}</div> : <ViewHead title="Anunțuri" sub={canPost ? 'Pentru clasele tale' : 'De la profesori și școală'} icon={<Icons.megaphone />} right={addButton} />}
      {err ? <LoadFailed err={err} retry={load} />
        : !data ? <div className="p-10 text-muted"><Spinner size={18} /> Se încarcă…</div>
        : data.items.length === 0 ? <Empty icon={<Icons.megaphone size={26} />} title="Niciun anunț" body={markRead ? 'Aici apar anunțurile profesorilor și ale școlii.' : 'Publică primul anunț, iar elevii vor primi o notificare.'} />
        : <div className="space-y-3">{data.items.map((a) => <AnnouncementCard key={a.id} a={a} onDelete={del} />)}</div>}
      <SchoolEvents school={school} canPost={!!school || !!canPost} />
      <Sheet open={adding} onClose={() => setAdding(false)} labelledBy="an-t">
        {adding && <AnnouncementForm school={school} targets={data ? data.targets : []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      </Sheet>
    </div>
  );
}

const NOTIFICATION_KINDS = {
  grade: { icon: Icons.chart, tone: 'bg-brand-50 text-brand-600', view: 'marks' },
  absence: { icon: Icons.calendar, tone: 'bg-heat-heavybg text-heat-heavy', view: 'marks' },
  excused: { icon: Icons.check, tone: 'bg-brand-50 text-brand-600', view: 'marks' },
  risk: { icon: Icons.alert, tone: 'bg-heat-heavybg text-heat-heavy', view: 'marks' },
  change: { icon: Icons.clock, tone: 'bg-heat-busybg text-heat-busy', view: 'today' },
  announcement: { icon: Icons.megaphone, tone: 'bg-brand-50 text-brand-600', view: 'announcements' },
  event: { icon: Icons.calendar, tone: 'bg-brand-50 text-brand-600', view: 'announcements' },
  message: { icon: Icons.message, tone: 'bg-brand-50 text-brand-600', view: 'messages' },
  assessment: { icon: Icons.book, tone: 'bg-paper text-ink', view: 'timetable' },
  reminder: { icon: Icons.alert, tone: 'bg-heat-heavybg text-heat-heavy', view: 'today' },
};
function StudentNotifications({ onRead, onGoto }) {
  const [n, setN] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => API.get('/api/notifications').then((d) => {
    setErr(null); setN(d); // keeps showing what was new on this visit, then clears the badge
    if (d.unread > 0) API.post('/api/notifications/read', {}).then(onRead).catch(() => {});
  }).catch((e) => setErr(errText(e))), [onRead]);
  useEffect(() => { load(); }, []);
  return (
    <div>
      <ViewHead title="Notificări" sub="Note, absențe, teme și lucrări" icon={<Icons.bell />} />
      {err ? <LoadFailed err={err} retry={load} />
        : !n ? <div className="p-10 text-muted"><Spinner size={18} /> Se încarcă…</div>
        : n.items.length === 0 ? <Empty icon={<Icons.bell size={26} />} title="Nicio notificare" body="Aici apar notele noi, absențele, temele și lucrările anunțate de profesori." />
        : <ul className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card">
            {n.items.map((x, i) => { const k = NOTIFICATION_KINDS[x.kind] || NOTIFICATION_KINDS.assessment; return (
              <li key={x.id} className={cx(i && 'border-t border-line')}>
                <button onClick={() => onGoto(k.view)} className={cx('flex w-full items-start gap-3 p-3.5 text-left hover:bg-paper', !x.read && 'bg-brand-50/50')}>
                  <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', k.tone)}><k.icon size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-[14px] leading-snug', x.read ? 'font-600' : 'font-700')}>{x.title}</span>
                    {x.body && <span className="mt-0.5 block text-[12.5px] text-muted">{x.body}</span>}
                    <span className="mt-0.5 block text-[11.5px] tnum text-muted">{fmtDate(x.createdAt.slice(0, 10))}, {x.createdAt.slice(11, 16)}</span>
                  </span>
                  {!x.read && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-label="necitită" />}
                </button>
              </li>
            ); })}
          </ul>}
    </div>
  );
}
function StudentToday({ s, reload, onGoto }) {
  const reduce = useReducedMotion();
  const t = s.today;
  const stagger = (i) => reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.05 + i * 0.07, ...spring } };
  const toggle = (task) => API.patch(`/api/tasks/${task.id}`, { done: !task.done }).then(reload).catch(toastError);
  if (!s.student.classId) return <div><ViewHead title={`Bună, ${s.student.name.split(' ')[0]}`} icon={<Icons.sun />} /><Empty icon={<Icons.sun size={26} />} title="Încă nu ești într-o clasă" body="Administratorul te repartizează la o clasă și îți adaugă orarul. Apoi aici apare rezumatul zilei tale." /></div>;
  return (
    <div>
      <motion.header {...stagger(0)} className="mb-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12.5px] font-500 text-muted">
          <span className="inline-flex items-center gap-1.5 text-brand-700"><Icons.sun size={14} /> {t.dateLabel}</span>
          <span className="text-line" aria-hidden="true">·</span>
          <span className="plastic px-2 py-0.5 text-[11.5px] font-600 text-brand-700" style={{ '--t': 'var(--color-accent-soft)', borderRadius: 999 }}>{s.student.class}</span>
        </div>
        <h1 className="mt-2 font-display text-[40px] font-700 leading-[0.95] tracking-[-0.03em] sm:text-[52px]">Azi</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="inline-flex items-baseline gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 font-600 text-brand-700 ring-1 ring-brand-100">
            <span className="font-display text-[15px] font-700 leading-none">{t.classes.length}</span> {t.classes.length === 1 ? 'oră azi' : 'ore azi'}
          </span>
          {t.due.length > 0 && (
            <span className="inline-flex items-baseline gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 font-600 text-ink shadow-card">
              <span className="font-display text-[15px] font-700 leading-none">{t.due.length}</span> de predat
            </span>
          )}
        </div>
      </motion.header>

      {t.forecast && (
        <motion.section {...stagger(1)} className="mt-4 flex items-start gap-3 rounded-xl2 border border-heat-busy/30 bg-heat-busybg p-4">
          <Icons.alert size={20} className="mt-0.5 shrink-0 text-heat-busy" />
          <p className="min-w-0 text-sm"><b className="font-700">{t.forecast.text}</b> {t.forecast.advice}</p>
        </motion.section>
      )}
      <div className="mt-6 grid grid-cols-1 gap-x-14 gap-y-9 lg:grid-cols-[minmax(0,560px)_300px]">
        <motion.section {...stagger(1)} className="lg:max-w-[640px]">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-xl font-700">Programul de azi</h2>
            {t.isWeekend && <span className="text-[12.5px] font-600 text-muted">previzualizare luni</span>}
          </div>
          {t.classes.length === 0
            ? <p className="py-6 text-[14px] text-muted">{t.module.holiday ? (t.module.resumes ? `E vacanță. Cursurile reîncep pe ${t.module.resumes}.` : 'E vacanță.') : 'Nicio oră azi.'}</p>
            : <>
                <div className="mb-4 flex gap-1" aria-hidden="true">
                  {t.classes.map((c, i) => (
                    <motion.div key={i} initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.08 + i * 0.05, ...spring }}
                      className={cx('h-2 flex-1 rounded-full', c.current && 'ring-2 ring-offset-2 ring-brand')} style={{ background: c.hue, transformOrigin: 'left', opacity: c.current ? 1 : 0.82 }} title={`${c.time} · ${c.subjectName}`} />
                  ))}
                </div>
                <ul className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card">
                  {t.classes.map((c, i) => (
                    <motion.li key={i} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.045, ...spring }}
                      className={cx('relative flex items-center gap-4 py-3.5 pl-5 pr-4', i > 0 && 'border-t border-line', c.current && 'bg-brand-50')}>
                      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: c.hue }} aria-hidden="true" />
                      <div className="w-12 shrink-0 font-mono leading-tight tnum">
                        <div className="text-[14px] font-600 text-ink">{c.time}</div><div className="text-[11px] text-muted">{c.end}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className={cx('min-w-0 truncate text-[15px] font-700 leading-tight', c.change && c.change.kind === 'cancelled' && 'text-muted line-through')}>{c.subjectName}</span>{c.current && <Pill tone="brand">acum</Pill>}</div>
                        {c.change && <div className="mt-0.5 text-[12.5px] font-700 text-heat-busy">{c.change.label}</div>}
                        {(c.change?.substitute || c.teacher) && <div className="mt-0.5 truncate text-[12.5px] text-muted">{c.change?.substitute || c.teacher}</div>}
                      </div>
                      <span className="shrink-0 rounded-lg bg-paper px-2.5 py-1 text-[12.5px] font-600" style={{ color: 'var(--color-ink-2)' }}>{(c.change?.kind === 'room' && c.change.room) || c.room || '—'}</span>
                    </motion.li>
                  ))}
                </ul>
              </>}
        </motion.section>

        <motion.div {...stagger(2)} className="flex flex-col">
          <section className="border-t border-line pt-6 first:border-t-0 first:pt-0">
            <h2 className="mb-2.5 text-[13.5px] font-700 text-muted">De predat curând</h2>
            <ul className="-mx-2 space-y-0.5">
              <AnimatePresence initial={false}>
                {t.due.length === 0 && <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-2 py-1 text-[13px] text-muted">Nimic urgent — zi liniștită.</motion.li>}
                {t.due.map((task) => (
                  <motion.li key={task.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    {task.kind === 'task'
                      ? <button onClick={() => toggle(task)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-paper">
                          <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-md border-2', task.done ? 'border-brand bg-brand text-white' : 'border-line')}>{task.done && <Icons.check size={14} sw={3} />}</span>
                          <span className="min-w-0 flex-1"><span className={cx('block truncate text-sm font-600', task.done && 'text-muted line-through')}>{task.title}</span><span className="block text-[12px] text-muted">{task.short ? task.short + ' · ' : ''}{task.typeLabel}</span></span>
                          <Pill tone={task.bucket === 'today' ? 'heavy' : 'muted'} className={task.bucket === 'today' ? 'bg-heat-heavybg' : ''}>{task.dueLabel}</Pill>
                        </button>
                      : <div className="flex w-full items-center gap-3 rounded-xl p-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-heat-heavybg text-heat-heavy"><Icons.alert size={13} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-600">{task.title}</span><span className="block text-[12px] text-muted">{task.short} · {task.typeLabel}</span></span><Pill tone={task.bucket === 'today' ? 'heavy' : 'muted'} className={task.bucket === 'today' ? 'bg-heat-heavybg' : ''}>{task.dueLabel}</Pill></div>}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
          {t.changes.length > 0 && (
            <section className="mt-6 border-t border-line pt-6">
              <h2 className="mb-2.5 text-[13.5px] font-700 text-muted">Schimbări în orar</h2>
              <ul className="space-y-2">{t.changes.map((c) => <li key={c.id} className="min-w-0"><p className="text-sm font-700">{c.subjectName}: {c.label}</p><p className="text-[12.5px] text-muted">{fmtDate(c.date)}, {c.time}{c.note && ` · ${c.note}`}</p></li>)}</ul>
            </section>
          )}
          {t.excuseDue.length > 0 && (
            <section className="mt-6 border-t border-line pt-6">
              <h2 className="text-[13.5px] font-700 text-muted">Adu scutirea</h2>
              <p className="mb-2 mt-1 text-[12.5px] text-muted">Absențe nemotivate recente. Verifică termenul cu dirigintele.</p>
              <ul className="space-y-1.5">{t.excuseDue.map((a) => <li key={a.id} className="text-sm"><b className="font-700">{a.subjectName}</b>, {fmtDate(a.date)}: până pe {fmtDate(a.until)}</li>)}</ul>
            </section>
          )}
          {t.nextDay && (
            <section className="mt-6 border-t border-line pt-6">
              <h2 className="text-[13.5px] font-700 text-muted">{t.nextDay.label}</h2>
              <p className="mt-1 text-[13px] text-muted">{t.nextDay.count === 1 ? '1 oră' : `${t.nextDay.count} ore`}, de la {t.nextDay.first}</p>
              <ul className="mt-3 space-y-1.5">{t.nextDay.pack.map((p) => <li key={p} className="flex items-center gap-2 text-sm"><Icons.bag size={15} className="shrink-0 text-muted" />{p}</li>)}</ul>
            </section>
          )}
          {t.announcements.length > 0 && (
            <section className="mt-6 border-t border-line pt-6">
              <button onClick={() => onGoto('announcements')} className="mb-2.5 flex w-full items-center justify-between text-left"><h2 className="text-[13.5px] font-700 text-muted">Anunțuri</h2><Icons.chevR size={16} className="text-muted" /></button>
              <ul className="space-y-2">{t.announcements.map((a) => (
                <li key={a.id} className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-700"><span className="min-w-0 truncate">{a.title}</span>{a.priority === 'urgent' && <span className="shrink-0 rounded-md bg-heat-heavy px-1.5 py-0.5 text-[11px] font-700 leading-none text-white">Urgent</span>}</p>
                  <p className="truncate text-[12.5px] text-muted">{a.author && `${a.author} · `}{announcementTarget(a)}</p>
                </li>
              ))}</ul>
            </section>
          )}
          {t.newGrades.length > 0 && (
            <section className="mt-6 border-t border-line pt-6">
              <button onClick={() => onGoto('marks')} className="mb-2.5 flex w-full items-center justify-between text-left"><h2 className="text-[13.5px] font-700 text-muted">Note noi</h2><Icons.chevR size={16} className="text-muted" /></button>
              <ul className="space-y-1.5">{t.newGrades.map((g) => (
                <li key={g.id} className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-700 tnum" style={gradeStyle(g.v)}>{g.v}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]"><b className="font-700">{g.short}</b> · {fmtDate(g.d)}{g.note && ` · ${g.note}`}</span>
                </li>
              ))}</ul>
            </section>
          )}
          {t.pack.length > 0 && (
            <section className="mt-6 border-t border-line pt-6">
              <h2 className="mb-2.5 flex items-center gap-2 text-[13.5px] font-700 text-muted"><Icons.bag size={16} className="text-brand" /> De pus în ghiozdan</h2>
              <ul className="flex flex-wrap gap-2">{t.pack.map((p, i) => <motion.li key={p} initial={reduce ? false : { opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 + i * 0.04 }} className="rounded-lg bg-paper px-2.5 py-1.5 text-[13px] font-500 text-ink">{p}</motion.li>)}</ul>
            </section>
          )}
        </motion.div>
      </div>
    </div>
  );
}
const STUDY_STEPS = ['Recitește notițele', 'Rezolvă exerciții', 'Fă un test de probă'];
const dayBefore = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Splits the days before a test or assignment into up to three steps, ending the day before.
function studyPlan(date) {
  const today = todayISO();
  const free = [3, 2, 1].map((n) => dayBefore(date, n)).filter((d) => d >= today);
  if (free.length === 0) return [{ date: today, step: 'Recapitulare rapidă' }];
  return free.map((d, i) => ({ date: d, step: STUDY_STEPS[i + STUDY_STEPS.length - free.length] }));
}
function UpcomingItem({ u, first }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cx(!first && 'border-t border-line')}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-paper/60">
        <span className="w-14 shrink-0 text-[13px] font-700 tnum text-muted">{fmtDate(u.date)}</span>
        <Dot hue={u.hue} />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-700">{u.title}</span><span className="block truncate text-[12.5px] text-muted">{u.subjectName} · {u.typeLabel}</span></span>
        <Icons.chevD size={16} className={cx('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <ol className="space-y-1 px-3.5 pb-3.5">{studyPlan(u.date).map((p) => <li key={p.date} className="flex gap-3 text-[13px]"><span className="w-14 shrink-0 font-700 tnum text-muted">{fmtDate(p.date)}</span><span>{p.step}</span></li>)}</ol>}
    </li>
  );
}
// A .ics file that Google Calendar and Apple Calendar can import.
const exportCalendar = () => API.get('/api/calendar').then((d) => {
  if (!d.count) return toast.info('Nu ai nimic de exportat încă.');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([d.ics], { type: 'text/calendar' }));
  link.download = 'schoolpilot.ics';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000); // Safari/Firefox need the URL a moment after click()
  toast.success('Calendarul a fost descărcat.');
}).catch(toastError);
function StudentTimetable({ s }) {
  return (
    <div>
      <ViewHead title="Orar" sub={s.hasTimetable ? `Săptămâna ${s.timetable.weekLabel} · azi evidențiat` : 'Orarul clasei tale'} icon={<Icons.grid />} />
      {!s.hasTimetable ? <Empty icon={<Icons.grid size={26} />} title="Orarul nu e gata" body="Administratorul adaugă orarul clasei tale. Imediat ce e pus, apare aici." />
        : <><TimetableGrid tt={s.timetable} /><p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-heat-heavy" /> evaluare</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-heat-light" /> temă</span></p></>}
      {s.workload && (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-display text-lg font-700">Evaluări</h2><button onClick={exportCalendar} className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-700 text-brand hover:text-brand-600"><Icons.download size={15} /> În calendar</button></div>
          <Heatmap wl={s.workload} typeLabel={s.typeLabel} />
          {s.upcoming.length > 0 && <ul className="mt-4 overflow-hidden rounded-xl2 border border-line bg-white shadow-card">{s.upcoming.map((u, i) => <UpcomingItem key={u.id} u={u} first={i === 0} />)}</ul>}
        </section>
      )}
    </div>
  );
}
function StudentMarks({ s, reload }) {
  const [tab, setTab] = useState('grades');
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ViewHead title="Catalog" sub="Note, medii și absențe — regulile din România" icon={<Icons.chart />} bare />
        <FluidTabs id="marks" active={tab} onChange={setTab} tabs={[{ id: 'grades', label: 'Note', icon: <Icons.chart size={15} /> }, { id: 'abs', label: 'Absențe', icon: <Icons.calendar size={15} /> }]} />
      </div>
      <AnimatePresence mode="wait">
        {tab === 'grades' ? <motion.div key="g" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .2 }}><GradesPanel s={s} reload={reload} /></motion.div>
          : <motion.div key="a" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .2 }}><AbsencesPanel s={s} reload={reload} /></motion.div>}
      </AnimatePresence>
    </div>
  );
}
function GradesPanel({ s, reload }) {
  const g = s.grades;
  const [open, setOpen] = useState(null);
  const [mod, setMod] = useState(0);
  const animOverall = useCountUp(g.overall);
  const mean = (l) => l.reduce((n, x) => n + x.v, 0) / l.length;
  const subjects = mod === 0 ? g.subjects : g.subjects.map((sub) => {
    const values = sub.values.filter((v) => v.module === mod);
    return values.length ? { ...sub, values, avg: mean(values), risk: mean(values) < 5.5 } : null;
  }).filter(Boolean);
  return (
    <div>
      {g.subjects.length > 0 && (
        <div className="mb-5 grid gap-3 lg:grid-cols-[minmax(210px,0.8fr)_1.25fr]">
          <div className="window-light relative overflow-hidden rounded-xl2 border border-line p-5 shadow-card" style={{ background: 'var(--color-paper-2)' }}>
            <p className="text-[12.5px] font-600 text-muted">Media generală</p>
            <div className="mt-2.5 flex items-end gap-2"><SplitFlap value={g.overall.toFixed(2)} big /><span className="pb-1.5 text-[12.5px] text-muted">anuală</span></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Materii" value={g.subjects.length} tone="#0E7490" icon={<Icons.book size={16} />} />
            {g.best && <StatTile label="Cea mai bună" value={g.best.short} tone="#16A34A" icon={<Icons.spark size={16} />} sub={`media ${g.best.avg.toFixed(2)}`} />}
            {g.worst && <StatTile label="De urmărit" value={g.worst.short} tone="#D92626" icon={<Icons.alert size={16} />} sub={`media ${g.worst.avg.toFixed(2)}`} />}
          </div>
        </div>
      )}
      {g.subjects.length > 0 && <PickChips label="Perioada" options={[{ id: 0, label: 'Tot anul' }, ...g.modules.map((n) => ({ id: n, label: `M${n}` }))]} value={mod} onChange={setMod} />}
      {g.subjects.length === 0 ? <Empty icon={<Icons.chart size={26} />} title="Încă nu ai note" body="Notele apar aici când le introduc profesorii. SchoolPilot îți calculează mediile și de ce notă mai ai nevoie." />
        : subjects.length === 0 ? <p className="rounded-xl2 border border-line bg-white p-6 text-center text-[13px] text-muted">Nicio notă în modulul {mod}.</p>
        : <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {subjects.map((sub) => (
              <motion.div key={sub.code} layout className={cx('rounded-xl2 border bg-white p-4 shadow-card', sub.risk ? 'border-heat-heavy/30' : 'border-line')}>
                <button onClick={() => setOpen(open === sub.code ? null : sub.code)} className="w-full text-left">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5"><Dot hue={sub.hue} size={12} /><span className="font-700">{sub.name}</span>{sub.risk && <Pill tone="heavy" className="bg-heat-heavybg">risc de corigență</Pill>}</div>
                    <div className="flex items-center gap-3"><span className="font-display text-2xl font-700 tnum" style={{ color: sub.risk ? '#D92626' : '#12201E' }}>{sub.avg.toFixed(2)}</span><motion.span animate={{ rotate: open === sub.code ? 180 : 0 }}><Icons.chevD size={18} className="text-muted" /></motion.span></div>
                  </div>
                </button>
                <p className="mb-1 text-[12px] text-muted">{mod ? `Media notelor din modulul ${mod}, orientativă` : `Media anuală: ${sub.annual}`}</p>
                <GoalRow sub={sub} reload={reload} />
                <GradeChips values={sub.values} />
                <GradeChart values={sub.values} hue={sub.hue} name={sub.name} />
                <AnimatePresence>{open === sub.code && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .25 }} className="overflow-hidden"><div className="mt-4 border-t border-line pt-4"><WhatINeed s={s} subject={sub.code} avg={sub.avg} reload={reload} /></div></motion.div>}</AnimatePresence>
              </motion.div>
            ))}
          </div>}
    </div>
  );
}
function GoalRow({ sub, reload }) {
  const goal = sub.goal;
  const change = (e) => API.post('/api/goals', { subject: sub.code, target: e.target.value ? Number(e.target.value) : null }).then(reload).catch(toastError);
  const reached = goal && (goal.reached || goal.already);
  const status = !goal ? null : reached ? 'Atins' : goal.count === 1 ? 'Îți mai trebuie o notă de 10' : `Îți mai trebuie ${goal.count} note de 10`;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
      <label className="flex items-center gap-1.5 font-700 text-muted">Obiectiv
        <select value={goal ? goal.target : ''} onChange={change} aria-label={`Obiectiv la ${sub.name}`} className="rounded-lg border border-line bg-white px-1.5 py-1 text-[12.5px] text-ink outline-none focus:border-brand">
          <option value="">—</option>{[5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {status && <span className={reached ? 'font-700 text-heat-calm' : 'text-muted'}>{status}</span>}
    </div>
  );
}
/* One subject's grades over time. Single series, so no legend; each point has a tooltip and the chips above are its table view. */
function GradeChart({ values, hue, name }) {
  if (values.length < 2) return null;
  const W = 300, H = 72, left = 14, right = 22, top = 8, bottom = 8;
  const x = (i) => left + (i * (W - left - right)) / (values.length - 1);
  const y = (v) => top + ((10 - v) * (H - top - bottom)) / 9;
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name}: note de la ${values[0].v} la ${last.v}`} className="mt-2 block h-auto w-full">
      {[5, 10].map((v) => <g key={v}><line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke="#E4E9E7" strokeWidth="1" /><text x="0" y={y(v) + 3.5} fontSize="10" fill="#5E6E6B">{v}</text></g>)}
      <polyline points={values.map((g, i) => `${x(i)},${y(g.v)}`).join(' ')} fill="none" stroke={hue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((g, i) => (
        <g key={g.id}>
          <circle cx={x(i)} cy={y(g.v)} r="4" fill={hue} stroke="#fff" strokeWidth="2" />
          <circle cx={x(i)} cy={y(g.v)} r="11" fill="transparent"><title>{`${g.v} · ${fmtDate(g.d)}`}</title></circle>
        </g>
      ))}
      <text x={x(values.length - 1) + 8} y={y(last.v) + 4} fontSize="12" fontWeight="700" fill="#12201E">{last.v}</text>
    </svg>
  );
}
/* Tap (or hover) a grade to see its date, note and teacher. */
function GradeChips({ values }) {
  const [picked, setPicked] = useState(null);
  const describe = (g) => [fmtDate(g.d), g.note, g.teacher].filter(Boolean).join(' · ');
  const shown = values.find((g) => g.id === picked);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">{values.map((g) => <button key={g.id} title={describe(g)} aria-label={`Nota ${g.v}, ${describe(g)}`} aria-pressed={picked === g.id} onClick={() => setPicked(picked === g.id ? null : g.id)} className={cx('grid h-9 w-9 place-items-center rounded-lg text-sm font-700 tnum', picked === g.id && 'ring-2 ring-brand')} style={gradeStyle(g.v)}>{g.v}</button>)}</div>
      {shown && <p className="mt-2 text-[12.5px] text-muted">{describe(shown)}</p>}
    </div>
  );
}
function WhatINeed({ s, subject, avg, reload }) {
  const [target, setTarget] = useState(Math.min(10, Math.ceil(avg) + 1));
  const [grade, setGrade] = useState(10);
  const [res, setRes] = useState(null);
  useEffect(() => { const id = setTimeout(() => { API.post('/api/grades/what-if', { subject, target, grade }).then(setRes).catch(toastError); }, 160); return () => clearTimeout(id); }, [subject, target, grade]);
  const tone = res && (res.already ? 'bg-heat-calmbg text-heat-calm' : !res.reachable ? 'bg-heat-heavybg text-heat-heavy' : 'bg-brand-50 text-brand-700');
  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-700"><Icons.target size={16} className="text-brand" /> De câte note ai nevoie?</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div><label className="text-[12px] text-muted">Media dorită</label><div className="mt-1"><Stepper value={target} set={setTarget} /></div></div>
        <div><label className="text-[12px] text-muted">Dacă iei note de</label><div className="mt-1"><Stepper value={grade} set={setGrade} /></div></div>
      </div>
      {res && <motion.div key={`${target}-${grade}-${res.already}-${res.reachable}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx('mt-4 rounded-xl p-3.5 text-sm', tone)}>
        {res.already ? <span>Ești deja la media <b>{target}</b> sau peste — nu mai ai nevoie de nicio notă.</span>
          : !res.reachable ? <span>Cu note de <b>{grade}</b> nu ajungi niciodată la media <b>{target}</b>, oricâte ai lua. Ai nevoie de note de cel puțin <b>{target}</b>.</span>
          : <span>Ai nevoie de încă <b className="font-display text-base">{res.count}</b> {res.count === 1 ? 'notă' : 'note'} de <b>{grade}</b> ca să ajungi la media <b>{target}</b>.</span>}
      </motion.div>}
    </div>
  );
}
function AbsencesPanel({ s, reload }) {
  const a = s.absences;
  const over = a.totUn >= a.threshold;
  return (
    <div>
      <div className="mb-5 grid gap-3 lg:grid-cols-[minmax(230px,0.85fr)_1.1fr]">
        <div className="window-light relative overflow-hidden rounded-xl2 border border-line p-5 shadow-card" style={{ background: 'var(--color-paper-2)' }}>
          <p className="text-[12.5px] font-600 text-muted">Absențe nemotivate</p>
          <div className="mt-2.5 flex items-end gap-2"><SplitFlap value={a.totUn} big /><span className="pb-1.5 text-[12.5px] text-muted">din {a.threshold}, pragul purtării</span></div>
          <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-white/50">
            <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, a.totUn / a.threshold) }} transition={{ duration: .6, ease: [0.16, 1, 0.3, 1] }} style={{ transformOrigin: 'left' }} className={cx('h-full w-full rounded-full', over ? 'bg-heat-heavy' : 'bg-brand')} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Motivate" value={a.totEx} tone="#16A34A" icon={<Icons.check size={16} />} />
          <StatTile label="Total" value={a.totUn + a.totEx} tone="#5E6E6B" icon={<Icons.calendar size={16} />} />
        </div>
      </div>
      {a.totUn >= 2 && <div className="mb-4 flex items-center gap-3 rounded-xl2 border border-heat-light/30 bg-heat-lightbg/60 p-3.5 text-sm"><Icons.alert size={18} className="shrink-0 text-heat-light" /><span className="text-ink/80">{a.totUn >= a.threshold
        ? <><b>Ai depășit pragul</b> de {a.threshold} absențe nemotivate care îți scade nota la purtare.</>
        : <>Mai ai <b>{a.threshold - a.totUn} {a.threshold - a.totUn === 1 ? 'absență nemotivată' : 'absențe nemotivate'}</b> până la pragul care îți scade nota la purtare.</>}</span></div>}
      {a.subjects.length === 0 ? <Empty icon={<Icons.calendar size={26} />} title="Nicio absență" body="Perfect — zero absențe. Pe măsură ce apar, le urmărești aici, motivate și nemotivate." />
        : <div className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card">
            {a.subjects.map((sub, i) => (
              <div key={sub.code} className={cx('flex items-center gap-3 p-4', i && 'border-t border-line')}>
                <Dot hue={sub.hue} size={12} /><span className="flex-1 font-700">{sub.name}</span>
                {sub.unexcused > 0 && <span className="rounded-lg bg-heat-heavybg px-2.5 py-1 text-[13px] font-700 text-heat-heavy tnum">{sub.unexcused} {sub.unexcused === 1 ? 'nemotivată' : 'nemotivate'}</span>}
                {sub.excused > 0 && <span className="rounded-lg bg-heat-calmbg px-2.5 py-1 text-[13px] font-700 text-heat-calm tnum">{sub.excused} {sub.excused === 1 ? 'motivată' : 'motivate'}</span>}
              </div>
            ))}
          </div>}
    </div>
  );
}

/* =====================================================================
 *  ROOT
 * ===================================================================== */
/* =====================================================================
 *  LANDING  (shown before login; the hero holds the Higgsfield film slot)
 * ===================================================================== */
// A landing scene pinned while you scroll through it, like the hero film: progress p (0..1) drives
// the visual in both directions. Reduced motion gets the finished state, unpinned.
function ScrollScene({ title, body, flip, Visual, shot }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const still = useMotionValue(1);
  const p = reduce ? still : scrollYProgress;
  const inner = (
    <div className={cx('mx-auto grid w-full max-w-6xl items-center gap-7 px-6 lg:gap-14', flip ? 'lg:grid-cols-[1.2fr_0.8fr]' : 'lg:grid-cols-[0.8fr_1.2fr]')}>
      <div className={cx('relative z-10 min-w-0', flip && 'lg:order-2')}>
        <h2 className="font-display text-[28px] font-700 leading-[1.08] sm:text-[40px]">{title}</h2>
        <p className="mt-3 max-w-md text-[15.5px] leading-relaxed text-muted sm:mt-4 sm:text-[16.5px]">{body}</p>
      </div>
      <div className={cx('relative min-w-0', flip && 'lg:order-1')}>
        {shot && <SceneShot p={p} src={shot} flip={flip} />}
        <div className="relative"><Visual p={p} /></div>
      </div>
    </div>
  );
  if (reduce) return <section ref={ref} className="overflow-hidden py-28 sm:py-40">{inner}</section>; // room for the backdrop's fade
  return (
    <section ref={ref} className="relative" style={{ height: '220vh' }}>
      <div className="graph-paper sticky top-0 flex h-[100svh] items-center overflow-hidden pt-14">{inner}</div>
    </section>
  );
}
// the matching slice of the real app, faded into the paper behind a scene's card; drifts slower than the page
function SceneShot({ p, src, flip }) {
  const reduce = useReducedMotion();
  const y = useTransform(p, [0, 1], reduce ? [0, 0] : [36, -36]);
  const opacity = useTransform(p, [0, 0.1], reduce ? [0.6, 0.6] : [0, 0.6]);
  const fade = 'radial-gradient(ellipse 70% 68% at 50% 48%, #000 40%, transparent 100%)';
  return (
    <div aria-hidden="true" className={cx('pointer-events-none absolute inset-y-0 flex w-[150%] items-center sm:w-[132%]', flip ? '-right-[10%]' : '-left-[10%]')}>
      <motion.img src={src} alt="" loading="lazy" decoding="async" style={{ y, opacity, WebkitMaskImage: fade, maskImage: fade }} className="block w-full rounded-2xl" />
    </div>
  );
}
// after the illustrated scenes: the real screens, on the devices people will use
function DeviceShowcase() {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const lapY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [50, -30]);
  const phoneY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [150, -80]);
  const frame = 'linear-gradient(#2c3530, #18201c)';
  return (
    <section className="overflow-hidden px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <h2 className="max-w-2xl font-display text-[28px] font-700 leading-[1.08] sm:text-[40px]">Și exact așa arată aplicația.</h2>
        <p className="mt-3 max-w-xl text-[15.5px] leading-relaxed text-muted sm:mt-4 sm:text-[16.5px]">Elevul își vede ziua pe telefon, profesorul ține catalogul pe laptop. Capturi reale, din școala demo.</p>
        <div ref={ref} className="relative mt-12 pb-[10%] sm:mt-16 sm:pb-[6%]">
          <motion.div style={{ y: lapY }} className="w-[90%] sm:w-[84%]">
            <div className="rounded-t-[1.3rem] rounded-b-md p-[1.3%] shadow-lift" style={{ background: frame }}>
              <img src="/media/app/laptop-catalog.webp" width="1920" height="1200" loading="lazy" decoding="async" alt="Catalogul profesorului: elevii clasei 10B, cu notele, absențele și mediile la matematică." className="block h-auto w-full rounded-[0.45rem]" />
            </div>
            <div className="relative -mx-[5%] h-3 rounded-b-[1.1rem] shadow-card sm:h-[18px]" style={{ background: 'linear-gradient(#e9ece7, #bcc5be)' }}>
              <span className="absolute left-1/2 top-0 h-[45%] w-[13%] -translate-x-1/2 rounded-b-lg" style={{ background: 'rgba(23,35,29,.12)' }} />
            </div>
          </motion.div>
          <motion.div style={{ y: phoneY }} className="absolute bottom-0 right-0 w-[36%] sm:w-[24%]">
            <div className="p-[3.4%] shadow-lift" style={{ background: frame, borderRadius: '15% / 7%' }}>
              <img src="/media/app/phone-azi.webp" width="780" height="1688" loading="lazy" decoding="async" alt="Pagina Azi a unui elev, pe telefon: orele de luni, cu matematica în desfășurare și avertismentul pentru joi." className="block h-auto w-full" style={{ borderRadius: '12% / 5.6%' }} />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
// how many of `edges` the progress has passed (re-renders only when that count changes)
function useStep(p, edges) {
  const count = (v) => edges.filter((e) => v >= e).length;
  const [n, setN] = useState(() => count(p.get()));
  useMotionValueEvent(p, 'change', (v) => { const k = count(v); setN((o) => (o === k ? o : k)); });
  return n;
}
const sceneCard = 'rounded-xl2 border border-line bg-white p-5 shadow-card';
const pop = { initial: { scale: 0.4, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.4, opacity: 0 }, transition: springBounce };

// 1 · Orar: the day ribbon grows, lessons slide in, "acum" settles on the current lesson
const ORAR = [['08:00', 'Matematică', 'Sala 12', 'var(--p-thu)'], ['09:00', 'Fizică', 'Lab F', 'var(--p-mon)'], ['10:00', 'Limba română', 'Sala 8', 'var(--p-wed)'], ['11:00', 'Engleză', 'Sala 5', 'var(--p-tue)']];
const ROW = 52;
function RibbonBar({ p, i }) {
  const s = useTransform(p, [0.04 + i * 0.045, 0.16 + i * 0.045], [0, 1]);
  return <motion.div className="h-2 flex-1 rounded-full" style={{ background: `var(--p-${['mon', 'tue', 'wed', 'thu', 'fri', 'sat'][i]})`, scaleX: s, transformOrigin: 'left' }} />;
}
function OrarRow({ p, i, row: [tm, s, r, h] }) {
  const a = 0.28 + i * 0.09, opacity = useTransform(p, [a, a + 0.08], [0, 1]), x = useTransform(p, [a, a + 0.08], [-18, 0]);
  return (
    <motion.div style={{ opacity, x, height: ROW }} className={cx('relative z-10 flex items-center gap-3 px-2', i > 0 && 'border-t border-line')}>
      <span className="w-12 font-mono text-[13px] text-ink">{tm}</span><Dot hue={h} /><span className="flex-1 truncate font-700">{s}</span><span className="text-[12.5px] text-muted">{r}</span>
    </motion.div>
  );
}
function OrarScene({ p }) {
  const nowO = useTransform(p, [0.7, 0.76], [0, 1]), nowY = useTransform(p, [0.76, 0.9], [0, ROW]);
  const now = useStep(p, [0.9]);
  return (
    <div className={sceneCard}>
      <div className="mb-4 flex gap-1">{[0, 1, 2, 3, 4, 5].map((i) => <RibbonBar key={i} p={p} i={i} />)}</div>
      <div className="relative">
        <motion.div aria-hidden="true" className="absolute inset-x-0 top-0 rounded-lg bg-brand-50" style={{ height: ROW, opacity: nowO, y: nowY, boxShadow: 'inset 3px 0 0 var(--color-accent)' }} />
        {ORAR.map((row, i) => <OrarRow key={i} p={p} i={i} row={row} />)}
      </div>
      <p className="mt-3 h-5 text-[13px] font-600 text-brand-700">
        <AnimatePresence>{now > 0 && <motion.span {...pop} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" />Acum: Fizică, în Lab F</motion.span>}</AnimatePresence>
      </p>
    </div>
  );
}

// 2 · Note: grades land one by one, the average follows, then the calculator answers
const NOTE = [9, 7, 8, 7, 9]; // media 8,00 → 2 note de 10 duc la 8,57, adică media 9
const NOTE_AT = [0.12, 0.24, 0.36, 0.48, 0.6];
function GradeChip({ p, i, v }) {
  const a = NOTE_AT[i], opacity = useTransform(p, [a - 0.05, a], [0, 1]), scale = useTransform(p, [a - 0.05, a, a + 0.03], [0.5, 1.12, 1]);
  return <motion.span style={{ opacity, scale, ...gradeStyle(v) }} className="grid h-10 w-10 place-items-center rounded-lg font-700 tnum">{v}</motion.span>;
}
function NoteScene({ p }) {
  const k = useStep(p, NOTE_AT);
  const avg = k ? (NOTE.slice(0, k).reduce((s, v) => s + v, 0) / k).toFixed(2).replace('.', ',') : '–';
  const msgO = useTransform(p, [0.74, 0.84], [0, 1]), msgY = useTransform(p, [0.74, 0.84], [12, 0]);
  return (
    <div className={sceneCard}>
      <div className="flex h-10 items-center gap-2.5">{NOTE.map((v, i) => <GradeChip key={i} p={p} i={i} v={v} />)}</div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        <div>
          <p className="text-[12.5px] text-muted">Media</p>
          <div className="relative h-[30px] min-w-[5.5rem] overflow-hidden">
            <AnimatePresence initial={false}>
              <motion.p key={avg} initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -22, opacity: 0 }} transition={spring}
                className="absolute inset-x-0 font-display text-3xl font-700 tnum leading-none">{avg}</motion.p>
            </AnimatePresence>
          </div>
        </div>
        <motion.p style={{ opacity: msgO, y: msgY }} className="rounded-xl bg-brand-50 px-3 py-2 text-[13px] font-600 text-brand-700">Îți mai trebuie <b>2 note de 10</b> pentru media 9.</motion.p>
      </div>
    </div>
  );
}

// 3 · Furtuna: three tests drop on Thursday, the day heats up, the warning arrives
const STORM_DAYS = [['Lun', HEAT.calm, ['Rom']], ['Mar', HEAT.light, ['Eng', 'Bio']], ['Mie', HEAT.calm, ['Ist']], ['Joi', null, []], ['Vin', HEAT.none, []]];
function StormChip({ p, i, label }) {
  const a = 0.12 + i * 0.16, y = useTransform(p, [a, a + 0.1], [-46, 0]), opacity = useTransform(p, [a, a + 0.05], [0, 1]);
  return <motion.span style={{ y, opacity }} className="block truncate rounded-md bg-white/85 px-1.5 py-1 text-[11px] font-700 shadow-sm" >{label}</motion.span>;
}
function StormScene({ p }) {
  const bg = useTransform(p, [0.1, 0.32, 0.56], [HEAT.calm.bg, HEAT.light.bg, HEAT.busy.bg]);
  const ring = useTransform(p, [0.1, 0.32, 0.56], [HEAT.calm.ring, HEAT.light.ring, HEAT.busy.ring]);
  const fg = useTransform(p, [0.1, 0.32, 0.56], [HEAT.calm.fg, HEAT.light.fg, HEAT.busy.fg]);
  const shadow = useTransform(ring, (r) => `inset 0 0 0 1.5px ${r}`);
  const alertO = useTransform(p, [0.68, 0.8], [0, 1]), alertY = useTransform(p, [0.68, 0.8], [18, 0]);
  return (
    <div>
      <div className={cx(sceneCard, 'grid grid-cols-5 gap-2')}>
        {STORM_DAYS.map(([d, heat, chips]) => {
          const joi = !heat;
          return (
            <div key={d} className="min-w-0">
              <motion.p className="mb-1.5 text-center font-mono text-[11.5px] font-500" style={{ color: joi ? fg : heat.fg }}>{d}</motion.p>
              <motion.div className="flex h-[132px] flex-col gap-1 rounded-lg p-1.5" style={joi ? { background: bg, boxShadow: shadow } :{ background: heat.bg, boxShadow: `inset 0 0 0 1.5px ${heat.ring}` }}>
                {joi ? ['Mate', 'Fiz', 'Chim'].map((c, i) => <StormChip key={c} p={p} i={i} label={c} />)
                     : chips.map((c) => <span key={c} className="block truncate rounded-md bg-white/85 px-1.5 py-1 text-[11px] font-700 shadow-sm">{c}</span>)}
              </motion.div>
            </div>
          );
        })}
      </div>
      <motion.div style={{ opacity: alertO, y: alertY }} className="mt-3 flex items-start gap-3 rounded-xl2 border border-heat-busy/30 bg-heat-busybg p-4 shadow-card">
        <Icons.alert size={22} className="mt-0.5 shrink-0 text-heat-busy" />
        <div><p className="font-700">Joi: 3 evaluări (Mate, Fiz, Chim).</p><p className="mt-1 text-[14px] text-muted">E cea mai încărcată zi a săptămânii. Începe recapitularea cu Chimie azi.</p></div>
      </motion.div>
    </div>
  );
}

// 4 · Brief: the morning list ticks itself off, then the day is ready
const BRIEF = [[<Dot hue="var(--p-thu)" />, 'Test la Fizică — optică'], [<Icons.bag size={16} className="shrink-0 text-brand" />, 'Halat de laborator, laptop'], [<span className="h-4 w-4 shrink-0 rounded border-2 border-line" />, 'De predat: eseu la engleză']];
function BriefScene({ p }) {
  const k = useStep(p, [0.22, 0.42, 0.62, 0.8]);
  return (
    <div className={sceneCard}>
      <p className="font-display text-xl font-700">Azi · <span className="text-muted">6 ore</span></p>
      <ul className="mt-3 text-[14px]">
        {BRIEF.map(([icon, text], i) => (
          <li key={i} className={cx('flex items-center gap-2.5 py-2.5', i > 0 && 'border-t border-line')}>
            <span className="grid w-4 shrink-0 place-items-center">{icon}</span>
            <span className={cx('flex-1 transition-colors duration-300', i < k ? 'text-muted' : 'text-ink')}>{text}</span>
            <span className="relative h-6 w-6 shrink-0 rounded-full border-2 border-line">
              <AnimatePresence>{i < k && <motion.span {...pop} className="absolute -inset-0.5 grid place-items-center rounded-full bg-brand text-white"><Icons.check size={14} /></motion.span>}</AnimatePresence>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 h-9 border-t border-line pt-3">
        <AnimatePresence>{k > 3 && <motion.p {...pop} className="font-display text-[17px] font-700 text-brand-700">Gata de școală.</motion.p>}</AnimatePresence>
      </div>
    </div>
  );
}
// Hero film: a Higgsfield clip (week organiser filling up), extracted to a WebP sequence so
// scrolling scrubs it frame-exact on a canvas (Apple's product-page technique; a seeking <video> stutters).
const FILM = { n: 72, w: 1280, h: 721, src: (i) => `/media/hero/f${String(i).padStart(3, '0')}.webp` };
const FILM_BEATS = [
  'Orarul tău se așază singur, zi cu zi.',
  'Joi se strâng trei teste? Afli din timp.',
  'Azi e pus în ordine. Tu doar îl deschizi.',
];
function ScrollFilm() {
  const reduce = useReducedMotion();
  const wrap = useRef(null), canvas = useRef(null), imgs = useRef([]), shown = useRef(-1), want = useRef(0);
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const cv = canvas.current, ctx = cv.getContext('2d');
    const size = () => { const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); shown.current = -1; draw(); };
    const draw = () => {
      // nearest loaded frame at or before the target, so a slow network still shows motion
      let i = want.current; while (i > 0 && !imgs.current[i]?.ok) i--;
      const im = imgs.current[i]; if (!im?.ok || i === shown.current) return;
      // cover-crop: on narrow screens the canvas is 3:2, so trim the film's empty sides, not the tray
      const s = Math.max(cv.width / im.naturalWidth, cv.height / im.naturalHeight), sw = cv.width / s, sh = cv.height / s;
      shown.current = i; ctx.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, 0, 0, cv.width, cv.height);
    };
    // frame 0 now (preloaded by the page); the other 71 only once the page has loaded,
    // in order and a few at a time, so they never compete with the app itself
    let stopped = false, started = false, next = 1;
    const load = (i) => {
      const im = new Image(); im.decoding = 'async'; imgs.current[i] = im;
      im.onload = () => { im.ok = true; if (i <= want.current) draw(); pump(); };
      im.onerror = pump;
      im.src = FILM.src(i);
    };
    const pump = () => { if (started && !stopped && next < FILM.n) load(next++); };
    const startRest = () => { started = true; for (let k = 0; k < 6; k++) pump(); };
    imgs.current = []; load(0);
    if (document.readyState === 'complete') setTimeout(startRest, 150); else window.addEventListener('load', startRest, { once: true });
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const r = wrap.current.getBoundingClientRect(), span = r.height - window.innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, span)));
      const f = Math.min(1, p / 0.66); // the film ends at 66% of the scroll; the rest holds the finished week
      want.current = Math.round(f * (FILM.n - 1)); draw();
      // cards land, Thursday glows; then a pause on the full week before the last line arrives
      setBeat(f < 0.5 ? 0 : p < 0.8 ? 1 : 2);
    }); };
    size(); onScroll();
    window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', size);
    return () => { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', size); window.removeEventListener('load', startRest); };
  }, [reduce]);
  const head = (
    <>
      <h1 className="font-display font-700 leading-[0.98] tracking-[-0.03em]" style={{ fontSize: 'clamp(2.3rem, 5.4vw, 4.4rem)' }}>Săptămâna ta,<br />pusă în ordine dinainte.</h1>
      <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted" style={{ textWrap: 'balance' }}>Orar, note, teme și evaluări — într-un singur loc. Pentru elevi, profesori și administratori.</p>
    </>
  );
  // fade the film's own paper into the page on all four edges (two linear masks, intersected)
  const fade = 'linear-gradient(to right, transparent, #000 11%, #000 89%, transparent), linear-gradient(to bottom, transparent, #000 13%, #000 87%, transparent)';
  const mask = { WebkitMaskImage: fade, maskImage: fade, WebkitMaskComposite: 'source-in', maskComposite: 'intersect' };
  if (reduce) return ( // no scrubbing: the finished week, still
    <section className="mx-auto flex max-w-6xl flex-col items-center px-6 pb-10 pt-28 text-center">
      {head}
      <img src={FILM.src(FILM.n - 1)} alt="" className="mt-8 w-full max-w-5xl" style={{ aspectRatio: `${FILM.w}/${FILM.h}`, ...mask }} />
    </section>
  );
  return (
    <section ref={wrap} className="relative" style={{ height: '480vh' }}>
      {/* the stage carries its own opaque grid paper: while pinned, nothing behind the film moves */}
      <div className="graph-paper sticky top-0 flex h-[100svh] flex-col items-center overflow-hidden px-6 pb-6 pt-20 text-center sm:pt-24">
        {head}
        <div className="relative mt-2 flex min-h-0 w-full flex-1 items-center justify-center">
          {/* width from whichever binds first: the column, 64rem, or the height left under the headline */}
          <canvas ref={canvas} aria-hidden="true" className="block h-auto [--ar:1.5] sm:[--ar:1.7778]"
            style={{ aspectRatio: 'var(--ar)', width: 'min(100%, 64rem, calc((100svh - 400px) * var(--ar)))', ...mask }} />
        </div>
        <div className="relative h-[4.6rem] w-full sm:h-14" aria-live="polite">
          <AnimatePresence initial={false}>
            <motion.p key={beat} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-x-0 mx-auto max-w-3xl font-display font-700 leading-[1.12]" style={{ fontSize: 'clamp(1.5rem, 3.2vw, 2.4rem)', textWrap: 'balance' }}>{FILM_BEATS[beat]}</motion.p>
          </AnimatePresence>
        </div>
        <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-600 text-muted">Derulează ca să vezi cum funcționează <Icons.chevD size={15} /></p>
      </div>
    </section>
  );
}
function Landing({ onLogin }) {
  const reduce = useReducedMotion();
  const rise = (d = 0) => reduce ? {} : { initial: { opacity: 0, y: 26 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, amount: 0.4 }, transition: { delay: d, ...spring } };
  return (
    <div className="graph-paper min-h-screen">
      <header className="edge-b fixed inset-x-0 top-0 z-30 backdrop-blur" style={{ background: 'color-mix(in oklab, var(--color-paper) 82%, transparent)' }}>
        <div className="mx-auto flex max-w-6xl items-center px-6 py-3.5">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })} aria-label="Înapoi sus" className="flex items-center gap-2.5"><Logo size={32} /><span className="font-display text-lg font-800 tracking-tight">SchoolPilot</span></button>
          <button type="button" onClick={onLogin} className="ml-auto rounded-full border border-line bg-white px-3.5 py-1.5 text-[13px] font-700 hover:bg-paper">Intră în cont</button>
        </div>
      </header>

      {/* HERO — Higgsfield film, scrubbed by scroll (see ScrollFilm) */}
      <ScrollFilm />

      <ScrollScene Visual={OrarScene} shot="/media/app/scene-orar.webp" title="Tot orarul, într-o privire." body="Zilele tale, colorate pe materii. Vezi dintr-o privire ce urmează, la ce oră și în ce sală." />
      <ScrollScene Visual={NoteScene} shot="/media/app/scene-note.webp" flip title="Notele și media, mereu la zi." body="Catalogul tău, clar. Plus calculatorul: îți spune de câte note ai nevoie ca să ajungi la media dorită." />
      <ScrollScene Visual={StormScene} shot="/media/app/scene-storm.webp" title="Vezi furtuna înainte să lovească." body="Trei teste în aceeași zi? Primești avertismentul din timp — și de unde să începi recapitularea." />
      <ScrollScene Visual={BriefScene} shot="/media/app/scene-azi.webp" flip title="Dimineața, ziua pusă în ordine." body="În fiecare dimineață: orele de azi, ce ai de predat și ce să pui în ghiozdan. Fără surprize." />

      <DeviceShowcase />

      <section className="mx-auto max-w-3xl px-6 py-24 text-center sm:py-28">
        <motion.h2 {...rise()} className="font-display text-[32px] font-700 leading-tight sm:text-[46px]">Gata să-ți pui săptămâna în ordine?</motion.h2>
        <motion.div {...rise(0.1)} className="mt-8"><button onClick={onLogin} className="dose-btn dose-btn--primary px-7 py-3.5 text-[16px]">Intră în cont</button></motion.div>
        <motion.p {...rise(0.2)} className="mt-5 text-[13px] text-muted">Conturile sunt create de administratorul școlii.</motion.p>
      </section>
      <footer className="border-t border-line py-8 text-center text-[13px] text-muted">SchoolPilot — pentru elevi, profesori și administratori.</footer>
    </div>
  );
}

// /?film — the welcome page as a self-running 16:9 loop, for the stand screen (press F11) and for recording.
// One clock t (seconds) drives everything, so each segment is a pure function of time.
const LOOP = { hero: 9.5, scene: 6.5, devices: 5, end: 6 };
const LOOP_CLIP = { src: '/media/hero-film.mp4', at: 0.3 }; // the original Higgsfield clip: 24 fps, 1364×768, 5.9 s
const LOOP_SCENES = [
  { Visual: OrarScene, shot: '/media/app/scene-orar.webp', title: 'Tot orarul, într-o privire.', body: 'Zilele tale, colorate pe materii: ce urmează, la ce oră și în ce sală.' },
  { Visual: NoteScene, shot: '/media/app/scene-note.webp', flip: true, title: 'Notele și media, mereu la zi.', body: 'Plus calculatorul: câte note îți mai trebuie ca să ajungi la media dorită.' },
  { Visual: StormScene, shot: '/media/app/scene-storm.webp', title: 'Vezi furtuna înainte să lovească.', body: 'Trei teste în aceeași zi? Afli din timp, și de unde să începi recapitularea.' },
  { Visual: BriefScene, shot: '/media/app/scene-azi.webp', flip: true, title: 'Dimineața, ziua pusă în ordine.', body: 'Orele de azi, ce ai de predat și ce pui în ghiozdan.' },
];
const LOOP_DEVICES = LOOP.hero + LOOP_SCENES.length * LOOP.scene;
const LOOP_END = LOOP_DEVICES + LOOP.devices;
const LOOP_TOTAL = LOOP_END + LOOP.end;
const fadeIO = (t, a, b, f = 0.5) => useTransform(t, [a - f, a, b - f, b], [0, 1, 1, 0]);
function LoopScene({ t, start, title, body, Visual, shot, flip, zoom }) {
  const opacity = fadeIO(t, start, start + LOOP.scene);
  const p = useTransform(t, [start + 0.3, start + 5], [0, 1]);
  const textY = useTransform(t, [start - 0.5, start + 0.4], [24, 0]);
  return (
    <motion.div style={{ opacity }} className="absolute inset-0 flex items-center">
      <div className={cx('mx-auto grid w-full max-w-[min(92vw,150vh)] items-center gap-[5vw]', flip ? 'grid-cols-[1.2fr_0.8fr]' : 'grid-cols-[0.8fr_1.2fr]')}>
        <motion.div style={{ y: textY }} className={cx('relative z-10', flip && 'order-2')}>
          <h2 className="font-display font-700 leading-[1.04]" style={{ fontSize: 'clamp(2rem, 4.6vh, 4.4rem)' }}>{title}</h2>
          <p className="mt-[2vh] text-muted" style={{ fontSize: 'clamp(1.05rem, 2.3vh, 1.9rem)', lineHeight: 1.45 }}>{body}</p>
        </motion.div>
        <div className={cx('relative', flip && 'order-1')} style={{ zoom }}>
          <SceneShot p={p} src={shot} flip={flip} />
          <div className="relative"><Visual p={p} /></div>
        </div>
      </div>
    </motion.div>
  );
}
function FilmLoop() {
  const t = useMotionValue(0);
  const [ready, setReady] = useState(false);
  const [qr, setQr] = useState(null);
  const scale = () => Math.min(1.6, Math.max(1, window.innerHeight / 760)); // the scene cards grow on big screens
  const [zoom, setZoom] = useState(scale);
  useEffect(() => { const on = () => setZoom(scale()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const video = useRef(null);
  const record = new URLSearchParams(location.search).has('record'); // no QR in a recorded video: the address changes
  useEffect(() => {
    // play the clip itself (smooth, full frame rate), from memory so it can rewind on every loop
    let url;
    fetch(LOOP_CLIP.src).then((r) => r.blob()).then((blob) => {
      url = URL.createObjectURL(blob); const v = video.current; v.src = url;
      v.addEventListener('canplaythrough', () => setReady(true), { once: true }); v.load();
    }).catch(() => setReady(true));
    if (!record) {
      fetch('/api/demo').then((r) => r.json()).then((d) => {
        if (!d.enabled || !d.publicUrl) return;
        const make = () => { const q = window.qrcode(0, 'M'); q.addData(`${d.publicUrl}/?demo`); q.make(); setQr(q.createSvgTag({ cellSize: 8, margin: 0, scalable: true })); };
        if (window.qrcode) make(); else { const sc = document.createElement('script'); sc.src = '/vendor/qrcode.js'; sc.onload = make; document.head.appendChild(sc); }
      }).catch(() => {});
    }
    document.body.style.cursor = 'none';
    return () => { document.body.style.cursor = ''; if (url) URL.revokeObjectURL(url); };
  }, []);
  // keep the clip in step with the loop clock: play during the hero, hold its last frame, rewind for the next loop
  const sync = (v) => {
    const el = video.current; if (!el || !el.duration) return;
    const want = Math.min(el.duration, Math.max(0, v - LOOP_CLIP.at));
    if (v < LOOP.hero && want < el.duration - 0.05) {
      if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
      if (el.paused && v >= LOOP_CLIP.at) el.play().catch(() => {});
    } else if (v >= LOOP.hero) { if (!el.paused) el.pause(); if (v > LOOP_TOTAL - 0.3 && el.currentTime !== 0) el.currentTime = 0; }
  };
  useMotionValueEvent(t, 'change', sync);
  useEffect(() => {
    if (!ready) return;
    let raf, start = performance.now();
    const tick = (now) => { t.set(((now - start) / 1000) % LOOP_TOTAL); raf = requestAnimationFrame(tick); };
    // ?record: hold on the first frame until the recorder calls __filmGo(), so the video starts at 0
    if (record) window.__filmGo = () => { start = performance.now(); raf = requestAnimationFrame(tick); };
    else raf = requestAnimationFrame(tick);
    window.__filmTotal = LOOP_TOTAL; window.__filmReady = true;
    return () => cancelAnimationFrame(raf);
  }, [ready]);
  const heroO = fadeIO(t, 0, LOOP.hero);
  const beat = (a, b) => ({ opacity: useTransform(t, [a, a + 0.4, b - 0.4, b], [0, 1, 1, 0]), y: useTransform(t, [a, a + 0.4, b - 0.4, b], [16, 0, 0, -16]) });
  const beats = [beat(0.3, 3.2), beat(3.2, 6.3), beat(6.5, LOOP.hero)]; // the clip ends at ~6.2 s; the last line lands on the finished week
  const devO = fadeIO(t, LOOP_DEVICES, LOOP_END);
  const lapY = useTransform(t, [LOOP_DEVICES - 0.5, LOOP_END], [60, -10]), phoneY = useTransform(t, [LOOP_DEVICES - 0.5, LOOP_END], [140, -30]);
  const endO = useTransform(t, [LOOP_END - 0.5, LOOP_END, LOOP_TOTAL - 0.6, LOOP_TOTAL], [0, 1, 1, 0]);
  const endY = useTransform(t, [LOOP_END - 0.5, LOOP_END + 0.5], [20, 0]);
  const fade = 'linear-gradient(to right, transparent, #000 11%, #000 89%, transparent), linear-gradient(to bottom, transparent, #000 13%, #000 87%, transparent)';
  const frame = 'linear-gradient(#2c3530, #18201c)';
  return (
    <MotionConfig reducedMotion="never">
      <div className="graph-paper fixed inset-0 overflow-hidden">
        {!ready && <div className="grid h-full place-items-center"><Logo size={72} /></div>}
        {/* hero */}
        <motion.div style={{ opacity: heroO }} className="absolute inset-0 flex flex-col items-center px-[4vw] pt-[6vh] text-center">
          <h1 className="font-display font-700 leading-[0.98] tracking-[-0.03em]" style={{ fontSize: 'clamp(2.6rem, 7.4vh, 6.6rem)' }}>Săptămâna ta,<br />pusă în ordine dinainte.</h1>
          <div className="relative mt-[2vh] flex min-h-0 w-full flex-1 items-center justify-center">
            <video ref={video} muted playsInline preload="auto" aria-hidden="true" className="block h-auto object-cover" style={{ aspectRatio: '1364 / 768', width: 'min(100%, calc((100vh - 38vh) * 1.776))', WebkitMaskImage: fade, maskImage: fade, WebkitMaskComposite: 'source-in', maskComposite: 'intersect' }} />
          </div>
          <div className="relative mb-[6vh] h-[7vh] w-full">
            {FILM_BEATS.map((txt, i) => <motion.p key={i} style={beats[i]} className="absolute inset-x-0 mx-auto max-w-[80vw] font-display font-700 leading-[1.1]" >{<span style={{ fontSize: 'clamp(1.6rem, 4.2vh, 3.6rem)' }}>{txt}</span>}</motion.p>)}
          </div>
        </motion.div>
        {LOOP_SCENES.map((sc, i) => <LoopScene key={i} t={t} start={LOOP.hero + i * LOOP.scene} zoom={zoom} {...sc} />)}
        {/* the real app */}
        <motion.div style={{ opacity: devO }} className="absolute inset-0 flex flex-col justify-center px-[6vw]">
          <h2 className="font-display font-700 leading-[1.05]" style={{ fontSize: 'clamp(2rem, 5vh, 4.6rem)' }}>Și exact așa arată aplicația.</h2>
          <div className="relative mt-[4vh] w-full max-w-[min(88vw,150vh)]">
            <motion.div style={{ y: lapY }} className="w-[80%]">
              <div className="rounded-t-[1.3rem] rounded-b-md p-[1.2%] shadow-lift" style={{ background: frame }}><img src="/media/app/laptop-catalog.webp" alt="" className="block h-auto w-full rounded-[0.45rem]" /></div>
              <div className="relative -mx-[5%] h-[2vh] rounded-b-[1.1rem] shadow-card" style={{ background: 'linear-gradient(#e9ece7, #bcc5be)' }} />
            </motion.div>
            <motion.div style={{ y: phoneY }} className="absolute bottom-[-4vh] right-[2%] w-[22%]">
              <div className="p-[3.4%] shadow-lift" style={{ background: frame, borderRadius: '15% / 7%' }}><img src="/media/app/phone-azi.webp" alt="" className="block h-auto w-full" style={{ borderRadius: '12% / 5.6%' }} /></div>
            </motion.div>
          </div>
        </motion.div>
        {/* end card */}
        <motion.div style={{ opacity: endO, y: endY }} className="absolute inset-0 flex items-center justify-center px-[6vw]">
          <div className={cx('grid w-full max-w-[min(90vw,150vh)] items-center gap-[6vw]', qr ? 'grid-cols-[1.2fr_0.8fr]' : 'grid-cols-1 text-center')}>
            <div className={qr ? '' : 'flex flex-col items-center'}>
              <div className="flex items-center gap-[1.6vh]"><Logo size={72} /><span className="font-display font-800 tracking-tight" style={{ fontSize: 'clamp(2rem, 5.4vh, 4.6rem)' }}>SchoolPilot</span></div>
              <p className="mt-[4vh] font-display font-700 leading-[1.04]" style={{ fontSize: 'clamp(2.2rem, 6.4vh, 5.6rem)', textWrap: 'balance' }}>Săptămâna ta, pusă în ordine dinainte.</p>
              <p className="mt-[2.4vh] text-muted" style={{ fontSize: 'clamp(1.1rem, 2.6vh, 2rem)' }}>{qr ? 'Scanează codul: intri direct în aplicație, ca elev.' : 'Pentru elevi, profesori și administratori.'}</p>
            </div>
            {qr && <div className="rounded-[2rem] border border-line bg-white p-[3vh] shadow-lift"><div className="aspect-square w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} /></div>}
          </div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}

// /?qr — for a screen at the stand: phones scan it and open the demo student's Azi.
// The code points at the public (tunnel) address that demo.sh records, so it is right even on localhost.
function DemoQR() {
  const [info, setInfo] = useState(null);
  const [ready, setReady] = useState(!!window.qrcode);
  useEffect(() => {
    const get = () => fetch('/api/demo').then((r) => r.json()).then(setInfo).catch(() => setInfo({ enabled: false }));
    get(); const poll = setInterval(get, 15000); // a restarted tunnel gets a new address
    if (!window.qrcode) { const sc = document.createElement('script'); sc.src = '/vendor/qrcode.js'; sc.onload = () => setReady(true); document.head.appendChild(sc); }
    return () => clearInterval(poll);
  }, []);
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  const base = (info && info.publicUrl) || (local ? null : location.origin);
  const link = base ? `${base}/?demo` : null;
  const svg = useMemo(() => {
    if (!ready || !link) return null;
    const q = window.qrcode(0, 'M'); q.addData(link); q.make();
    return q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
  }, [ready, link]);
  const problem = !info ? null : !info.enabled ? 'Modul demo nu e pornit. Pornește serverul cu ./demo.sh.'
    : !link ? 'Nu știu adresa publică. Pornește tunelul cu ./demo.sh sau deschide pagina de pe adresa tunelului.' : null;
  return (
    <div className="graph-paper grid min-h-screen place-items-center px-6 py-10">
      <div className="grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div>
          <div className="flex items-center gap-3"><Logo size={44} /><span className="font-display text-2xl font-800 tracking-tight">SchoolPilot</span></div>
          <h1 className="mt-8 font-display font-700 leading-[1.02]" style={{ fontSize: 'clamp(2.4rem, 5vw, 4.6rem)', textWrap: 'balance' }}>Încearcă aplicația pe telefonul tău.</h1>
          <ol className="mt-8 space-y-4 text-[clamp(1.05rem,1.6vw,1.35rem)]">
            {['Scanează codul cu camera telefonului.', `Intri direct ca ${info && info.name ? info.name : 'un elev'}, pe pagina Azi. Fără parolă.`, 'Uită-te prin orar, note și anunțuri, sau scrie-i un mesaj profesorului.'].map((t, i) => (
              <li key={i} className="flex items-start gap-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand font-display font-700 text-white">{i + 1}</span><span className="pt-1">{t}</span></li>
            ))}
          </ol>
        </div>
        <div className="mx-auto w-full max-w-[460px]">
          <div className="rounded-[28px] border border-line bg-white p-7 shadow-lift">
            {svg ? <div className="aspect-square w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
              : <div className="grid aspect-square w-full place-items-center rounded-2xl bg-paper p-6 text-center text-[15px] text-muted">{problem || <Spinner size={22} />}</div>}
          </div>
          {link && <p className="mt-4 break-all text-center font-mono text-[13px] text-muted">{link.replace(/^https?:\/\//, '')}</p>}
        </div>
      </div>
    </div>
  );
}

function Root() {
  const [phase, setPhase] = useState('boot'); // boot | landing | login | change | app | error
  const [account, setAccount] = useState(null);
  const [notice, setNotice] = useState(null);
  const toLogin = (msg) => { setAccount(null); setNotice(msg || null); setPhase('login'); };
  const logout = async () => {
    if (demoToken) { setDemo(null); setAccount(null); setNotice(null); setPhase('landing'); window.scrollTo(0, 0); return; }
    try { await sb.auth.signOut(); } catch (e) {} toLogin();
  };
  const qrMode = new URLSearchParams(location.search).has('qr');
  const filmMode = new URLSearchParams(location.search).has('film');
  // Who am I? Identity comes from the Supabase session token, checked by the server.
  const loadMe = async () => {
    try {
      const me = await API.get('/api/me');
      setAccount(me); setNotice(null); setPhase(me.mustChangePassword ? 'change' : 'app');
    } catch (e) {
      await sb.auth.signOut().catch(() => {});
      throw e;
    }
  };
  useEffect(() => {
    onUnauthorized = () => {
      if (demoToken) { setDemo(null); setAccount(null); setPhase('landing'); return; }
      if (sb) sb.auth.signOut().catch(() => {}); toLogin('Sesiunea a expirat. Intră din nou în cont.');
    };
    onMustChangePassword = () => { loadMe().catch((e) => toLogin(errText(e))); };
    // Never trap the user on the boot spinner: if the session check or /api/me stalls — e.g. a
    // stored token that can't reach Supabase — fall back to the login screen after a short guard.
    let settled = false;
    const done = () => { settled = true; };
    const guard = setTimeout(() => { if (!settled) { done(); toLogin(); } }, 9000);
    if (qrMode || filmMode) return () => clearTimeout(guard);
    fetch('/api/config').then((r) => r.json()).then(async (cfg) => {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
      // /?demo (the stand's QR code): straight into the demo student's Azi
      if (new URLSearchParams(location.search).has('demo')) {
        const d = await fetch('/api/demo?pass=1').then((r) => r.json()).catch(() => ({}));
        history.replaceState(null, '', location.pathname);
        if (d.token) setDemo(d.token);
        else { done(); setNotice('Modul demo nu este pornit acum.'); return setPhase('landing'); }
      }
      if (demoToken) {
        try { await loadMe(); } catch (e) { setDemo(null); setPhase('landing'); } finally { done(); }
        return;
      }
      const { data } = await sb.auth.getSession();
      if (!data.session) { done(); return setPhase('landing'); }
      try { await loadMe(); } catch (e) { toLogin(errText(e)); } finally { done(); }
    }).catch((e) => { done(); setNotice(errText(e)); setPhase('error'); });
    return () => clearTimeout(guard);
  }, []);
  if (qrMode) return <DemoQR />;
  if (filmMode) return <FilmLoop />;
  if (phase === 'boot') return <div className="graph-paper grid min-h-screen place-items-center text-muted"><Spinner size={18} /></div>;
  if (phase === 'error') return <AuthCard sub="Autentificare"><FormError>Nu pot contacta serverul: {notice}. Pornește <code className="rounded bg-paper px-1">python3 server.py</code>.</FormError></AuthCard>;
  if (phase === 'landing') return <Landing onLogin={() => setPhase('login')} />;
  if (phase === 'login' || !account) return <Login onSignedIn={loadMe} notice={notice} onHome={() => { setNotice(null); setPhase('landing'); window.scrollTo(0, 0); }} />;
  if (phase === 'change') return <ChangePassword account={account} onDone={() => loadMe().catch((e) => toLogin(errText(e)))} onLogout={logout} />;
  if (account.role === 'admin') return <AdminApp account={account} onLogout={logout} />;
  if (account.role === 'teacher') return <TeacherApp account={account} onLogout={logout} />;
  return <StudentApp account={account} onLogout={logout} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<><Root /><MotionConfig reducedMotion="user"><Toaster /><ConfirmHost /></MotionConfig></>);
