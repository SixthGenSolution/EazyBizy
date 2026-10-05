/**
 * AIInsightPanel — Collapsible step-aware AI assistant panel.
 *
 * Features surfaced per step:
 *   Step 3 → Scheme Recommender
 *   Steps 5, 7 → Smart Field Benchmarks
 *   Step 9 → Viability preview
 *   All steps → Business Plan draft (tab)
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, ChevronRight, ChevronLeft, TrendingUp, Lightbulb,
  FileText, ShieldCheck, AlertCircle, CheckCircle2, XCircle,
  Copy, CheckCheck, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { GTABFormData } from '@/types/gtab';
import {
  recommendScheme,
  getFieldBenchmarks,
  predictViability,
  generateBusinessPlanDraft,
  type SchemeOption,
  type ViabilityIssue,
} from '@/lib/aiEngine';

interface AIInsightPanelProps {
  formData: GTABFormData;
  currentStep: number;
  onSwitchScheme?: (schemeId: string) => void;
}

type Tab = 'scheme' | 'tips' | 'viability' | 'plan';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);

const bandColor = (band: string) => ({
  strong: 'bg-emerald-500',
  good:   'bg-blue-500',
  review: 'bg-amber-500',
  weak:   'bg-red-500',
})[band] ?? 'bg-gray-500';

const bandLabel = (band: string) => ({
  strong: 'Strong',
  good:   'Good',
  review: 'Needs Work',
  weak:   'Weak',
})[band] ?? band;

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const SchemeCard = ({ scheme, best }: { scheme: SchemeOption; best: boolean }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={cn(
      'rounded-xl border p-3 text-xs transition-all',
      scheme.eligible
        ? best ? 'border-emerald-400/50 bg-emerald-900/20' : 'border-white/10 bg-white/5'
        : 'border-white/5 bg-white/[0.02] opacity-60',
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {best && <span className="text-[9px] font-bold bg-emerald-500 text-white rounded px-1.5 py-0.5 shrink-0">BEST</span>}
          <span className="font-semibold text-white truncate">{scheme.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {scheme.eligible
            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            : <XCircle className="w-3.5 h-3.5 text-red-400" />}
          {scheme.eligible && (
            <button onClick={() => setExpanded(v => !v)} className="text-white/40 hover:text-white/70">
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="text-[10px] text-white/50">Max: {fmt(scheme.maxLoan)}</span>
        {scheme.subsidy !== 'None' && (
          <span className="text-[10px] text-amber-300 font-medium">{scheme.subsidy}</span>
        )}
        {!scheme.collateral && (
          <span className="text-[10px] text-blue-300">No collateral</span>
        )}
      </div>
      {!scheme.eligible && scheme.eligibilityReason && (
        <p className="mt-1 text-[10px] text-red-300/80">{scheme.eligibilityReason}</p>
      )}
      {expanded && scheme.eligible && (
        <div className="mt-2 space-y-1.5 border-t border-white/10 pt-2">
          <div>
            <p className="text-[10px] text-emerald-300 font-medium mb-0.5">Pros</p>
            {scheme.pros.map(p => <p key={p} className="text-[10px] text-white/70">• {p}</p>)}
          </div>
          <div>
            <p className="text-[10px] text-red-300 font-medium mb-0.5">Cons</p>
            {scheme.cons.map(c => <p key={c} className="text-[10px] text-white/70">• {c}</p>)}
          </div>
        </div>
      )}
    </div>
  );
};

const IssueRow = ({ issue }: { issue: ViabilityIssue }) => (
  <div className={cn(
    'rounded-lg border p-2.5 text-xs',
    issue.severity === 'error'   ? 'border-red-500/40 bg-red-950/30' :
    issue.severity === 'warning' ? 'border-amber-500/40 bg-amber-950/30' :
                                   'border-emerald-500/40 bg-emerald-950/20',
  )}>
    <div className="flex items-start gap-2">
      {issue.severity === 'error'
        ? <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
        : issue.severity === 'warning'
          ? <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />}
      <div>
        <p className="font-semibold text-white">{issue.label}</p>
        <p className="text-white/60 mt-0.5">{issue.detail}</p>
        {issue.fix && <p className="text-blue-300 mt-1">Fix: {issue.fix}</p>}
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Panel
// ─────────────────────────────────────────────────────────────────────────────

export default function AIInsightPanel({ formData, currentStep, onSwitchScheme }: AIInsightPanelProps) {
  const [open, setOpen]   = useState(false);
  const [tab, setTab]     = useState<Tab>('scheme');
  const [copied, setCopied] = useState(false);

  // Default the active tab based on current step
  const defaultTab: Tab =
    currentStep === 2 ? 'scheme' :
    currentStep === 7 || currentStep === 9 ? 'tips' :
    currentStep === 4 ? 'viability' : 'scheme';

  const activeTab = open ? tab : defaultTab;

  const recommendation = useMemo(() => recommendScheme(formData), [formData]);
  const benchmarks     = useMemo(() => getFieldBenchmarks(formData.industry_type || 'manufacturing', 0), [formData.industry_type]);
  const viability      = useMemo(() => predictViability(formData), [formData]);
  const planDraft      = useMemo(() => generateBusinessPlanDraft(formData), [formData]);

  const handleCopyPlan = async () => {
    await navigator.clipboard.writeText(planDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const TABS: Array<{ id: Tab; icon: typeof Sparkles; label: string }> = [
    { id: 'scheme',    icon: ShieldCheck, label: 'Scheme' },
    { id: 'tips',      icon: Lightbulb,   label: 'Tips' },
    { id: 'viability', icon: TrendingUp,  label: 'Viability' },
    { id: 'plan',      icon: FileText,    label: 'Plan' },
  ];

  return (
    <>
      {/* Collapsed trigger button */}
      {!open && (
        <motion.button
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => { setOpen(true); setTab(defaultTab); }}
          className="fixed right-0 top-1/2 z-50 flex h-36 w-11 max-w-11 -translate-y-1/2 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-l-xl px-1 py-3 shadow-xl"
          style={{ background: 'hsl(174 72% 36%)', color: 'white' }}
          title="Open AI Insights"
        >
          <Sparkles className="w-4 h-4" />
          <span className="text-[10px] font-bold [writing-mode:vertical-lr] rotate-180">AI Insights</span>
          <ChevronLeft className="w-3 h-3" />
        </motion.button>
      )}

      {/* Overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
              onClick={() => setOpen(false)}
            />

            <motion.div
              key="panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden shadow-2xl"
              style={{
                width: 'min(380px, 92vw)',
                background: 'hsl(220 24% 10%)',
                borderLeft: '1px solid hsl(220 20% 18%)',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 shrink-0"
                style={{ background: 'hsl(174 72% 30% / 0.15)', borderBottom: '1px solid hsl(220 20% 18%)' }}>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg"
                    style={{ background: 'hsl(174 72% 56% / 0.20)' }}>
                    <Sparkles className="h-3.5 w-3.5" style={{ color: 'hsl(174 72% 56%)' }} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">AI Insights</p>
                    <p className="text-[10px]" style={{ color: 'hsl(174 72% 56%)' }}>Step {currentStep} · Powered by rule-based engine</p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex shrink-0 border-b" style={{ borderColor: 'hsl(220 20% 18%)' }}>
                {TABS.map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={cn(
                      'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
                      activeTab === t.id
                        ? 'text-white border-b-2 border-cyan-400'
                        : 'text-gray-500 hover:text-gray-300',
                    )}>
                    <t.icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3" style={{ scrollbarWidth: 'thin' }}>

                {/* ── SCHEME TAB ───────────────────────────────────────────── */}
                {activeTab === 'scheme' && (
                  <>
                    {/* ── Switch advisory banner (shows when selected ≠ best) ── */}
                    {!recommendation.isSelectedOptimal && recommendation.best?.eligible && recommendation.switchBenefit && (
                      <div className="rounded-xl p-3 space-y-2.5" style={{ background: 'hsl(38 92% 50% / 0.12)', border: '1px solid hsl(38 92% 50% / 0.35)' }}>
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: 'hsl(38 92% 65%)' }} />
                          <p className="text-[11px] font-bold" style={{ color: 'hsl(38 92% 72%)' }}>CA RECOMMENDATION</p>
                        </div>
                        <p className="text-[11px] text-white/80 leading-relaxed">{recommendation.switchBenefit}</p>

                        {/* Current vs Best row */}
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div className="rounded-lg px-2.5 py-2 space-y-0.5" style={{ background: 'hsl(0 72% 50% / 0.15)', border: '1px solid hsl(0 72% 50% / 0.30)' }}>
                            <p style={{ color: 'hsl(0 72% 65%)' }} className="font-bold uppercase tracking-wide">Your pick</p>
                            <p className="text-white font-semibold">{recommendation.selectedScheme?.name ?? formData.loan_scheme?.toUpperCase()}</p>
                            {recommendation.selectedScheme?.dscrUnderScheme > 0 && (
                              <p style={{ color: 'hsl(0 72% 70%)' }}>DSCR ~{recommendation.selectedScheme.dscrUnderScheme.toFixed(2)}x</p>
                            )}
                          </div>
                          <div className="rounded-lg px-2.5 py-2 space-y-0.5" style={{ background: 'hsl(142 72% 40% / 0.18)', border: '1px solid hsl(142 72% 40% / 0.35)' }}>
                            <p style={{ color: 'hsl(142 72% 55%)' }} className="font-bold uppercase tracking-wide">CA suggests</p>
                            <p className="text-white font-semibold">{recommendation.best.name}</p>
                            {recommendation.subsidySavingsFromSwitch > 0 && (
                              <p style={{ color: 'hsl(142 72% 65%)' }} className="font-semibold">+₹{recommendation.subsidySavingsFromSwitch.toLocaleString('en-IN')} subsidy</p>
                            )}
                            {recommendation.best.dscrUnderScheme > 0 && (
                              <p style={{ color: 'hsl(142 72% 60%)' }}>
                                DSCR ~{recommendation.best.dscrUnderScheme.toFixed(2)}x
                                {recommendation.dscrGainFromSwitch > 0.05 && ` (+${recommendation.dscrGainFromSwitch.toFixed(2)})`}
                              </p>
                            )}
                          </div>
                        </div>

                        {onSwitchScheme && (
                          <button
                            onClick={() => onSwitchScheme(recommendation.best!.id)}
                            className="w-full rounded-lg py-2 text-[11px] font-bold text-white transition-all hover:opacity-90 active:scale-95"
                            style={{ background: 'hsl(38 92% 50%)', color: 'hsl(220 24% 10%)' }}
                          >
                            Switch to {recommendation.best.name} →
                          </button>
                        )}
                      </div>
                    )}

                    {/* Summary line when already optimal */}
                    {recommendation.isSelectedOptimal && (
                      <div className="rounded-xl p-3 text-xs" style={{ background: 'hsl(142 72% 40% / 0.12)', border: '1px solid hsl(142 72% 40% / 0.25)' }}>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <p className="font-medium text-white">{recommendation.summary}</p>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      {recommendation.all.map(s => (
                        <SchemeCard key={s.id} scheme={s} best={s.id === recommendation.best?.id} />
                      ))}
                    </div>
                  </>
                )}

                {/* ── TIPS TAB ─────────────────────────────────────────────── */}
                {activeTab === 'tips' && (
                  <>
                    <p className="text-[11px] text-white/50 font-medium uppercase tracking-wide">
                      Industry benchmarks · {(formData.industry_type || 'Manufacturing').charAt(0).toUpperCase() + (formData.industry_type || 'manufacturing').slice(1)}
                    </p>
                    {benchmarks.map(b => (
                      <div key={b.field} className="rounded-xl border p-3 text-xs space-y-1"
                        style={{ borderColor: 'hsl(220 20% 20%)', background: 'hsl(220 20% 14%)' }}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-white">{b.label}</span>
                          <span className="text-cyan-300 font-medium shrink-0">{b.typical}</span>
                        </div>
                        <p className="text-white/50">{b.tip}</p>
                      </div>
                    ))}
                  </>
                )}

                {/* ── VIABILITY TAB ─────────────────────────────────────────── */}
                {activeTab === 'viability' && (
                  <>
                    {/* Score gauge */}
                    <div className="rounded-xl p-4 text-center" style={{ background: 'hsl(220 20% 14%)', border: '1px solid hsl(220 20% 20%)' }}>
                      <div className="relative mx-auto mb-2" style={{ width: 72, height: 72 }}>
                        <svg viewBox="0 0 72 72" className="w-full h-full -rotate-90">
                          <circle cx="36" cy="36" r="30" fill="none" stroke="hsl(220 20% 20%)" strokeWidth="8" />
                          <circle cx="36" cy="36" r="30" fill="none"
                            stroke={viability.band === 'strong' ? '#10b981' : viability.band === 'good' ? '#3b82f6' : viability.band === 'review' ? '#f59e0b' : '#ef4444'}
                            strokeWidth="8"
                            strokeDasharray={`${(viability.score / 100) * 188.5} 188.5`}
                            strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xl font-bold text-white">{viability.score}</span>
                        </div>
                      </div>
                      <Badge className={cn('text-white border-0 text-xs', bandColor(viability.band))}>
                        {bandLabel(viability.band)}
                      </Badge>
                      <p className="mt-2 text-xs text-white/60">{viability.recommendation}</p>
                    </div>

                    {/* Key numbers */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'DSCR', value: viability.dscrEstimate > 0 ? `${viability.dscrEstimate.toFixed(2)}x` : 'N/A', ok: viability.dscrEstimate >= 1.25 },
                        { label: 'Gross Margin', value: `${viability.grossMarginPct.toFixed(0)}%`, ok: viability.grossMarginPct >= 20 },
                        { label: 'Monthly P&L', value: viability.monthlyProfit >= 0 ? fmt(viability.monthlyProfit) : `-${fmt(Math.abs(viability.monthlyProfit))}`, ok: viability.monthlyProfit >= 0 },
                      ].map(m => (
                        <div key={m.label} className="rounded-lg p-2 text-center" style={{ background: 'hsl(220 20% 14%)' }}>
                          <p className="text-[10px] text-white/40">{m.label}</p>
                          <p className={cn('text-xs font-bold mt-0.5', m.ok ? 'text-emerald-400' : 'text-amber-400')}>{m.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Strengths */}
                    {viability.strengths.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide">Strengths</p>
                        {viability.strengths.map(s => (
                          <div key={s} className="flex items-start gap-1.5 text-xs text-white/70">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                            {s}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Issues */}
                    {viability.issues.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wide">Issues to Fix</p>
                        {viability.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}
                      </div>
                    )}
                  </>
                )}

                {/* ── PLAN TAB ──────────────────────────────────────────────── */}
                {activeTab === 'plan' && (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-white/50 font-medium uppercase tracking-wide">AI-generated draft</p>
                      <button onClick={handleCopyPlan}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all hover:opacity-90"
                        style={{ background: 'hsl(174 72% 56% / 0.15)', color: 'hsl(174 72% 65%)', border: '1px solid hsl(174 72% 56% / 0.25)' }}>
                        {copied ? <><CheckCheck className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy All</>}
                      </button>
                    </div>
                    <div className="rounded-xl border p-3 text-xs text-white/75 leading-relaxed whitespace-pre-wrap"
                      style={{ borderColor: 'hsl(220 20% 20%)', background: 'hsl(220 20% 12%)' }}>
                      {planDraft.split('**').map((segment, i) =>
                        i % 2 === 1
                          ? <strong key={i} className="text-white">{segment}</strong>
                          : <span key={i}>{segment}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-white/30 text-center">
                      This is a starting draft — edit it to match your specific business details.
                    </p>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
