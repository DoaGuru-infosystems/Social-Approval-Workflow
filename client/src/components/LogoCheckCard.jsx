import React from 'react';
import { ShieldCheck, AlertOctagon, Info, Sparkles, Binary } from 'lucide-react';

/**
 * LogoCheckCard Component
 * Displays Dedicated Brand Logo Verification Card in SMO Studio & Manager Review.
 *
 * Rules:
 * - SKIPPED: "Logo Check Skipped - Logo upload nahi hai" (Neutral, does NOT fail post)
 * - PASS: "PASS - Logo mil gaya - Neeche Right corner me hai - Score 0.94 - Checked By: Gemini"
 * - FAIL: "FAIL - Logo post me kahin nahi mila. Suggestion: Logo ko neeche right corner me saaf jagah pe lagayein. - Checked By: Python"
 */
const LogoCheckCard = ({ logoCheck, aiProvider, fallbackUsed }) => {
  if (!logoCheck || logoCheck.status === 'SKIPPED') {
    return (
      <div className="p-4 rounded-2xl bg-[#F6F5F2] border border-[#E5E2DA] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-[#8C8B85]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#6B6A63]">
              Logo Check
            </span>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-700 uppercase">
            Skipped
          </span>
        </div>
        <p className="text-xs font-semibold text-[#2B2A27]">
          Logo Check Skipped - Logo upload nahi hai
        </p>
        <p className="text-[11px] text-[#6B6A63]">
          Brand Guidelines me official brand logo upload nahi hai. Poster approval is check se block nahi hoga.
        </p>
      </div>
    );
  }

  const isPass = logoCheck.status === 'PASS';
  const checkedBy = logoCheck.checked_by || (aiProvider === 'python' || fallbackUsed ? 'Python' : 'Gemini');
  const scoreFormatted = Number(logoCheck.score || 0).toFixed(2);
  const locationHindi = logoCheck.location_hindi || 'Sahi jagah pe hai';

  // Construct standardized display text
  let primaryText = '';
  if (isPass) {
    primaryText = `PASS - Logo mil gaya - ${locationHindi} - Score ${scoreFormatted} - Checked By: ${checkedBy}`;
  } else {
    const rawSuggestion = logoCheck.suggestion || 'Logo post me kahin nahi mila.';
    primaryText = `FAIL - ${rawSuggestion} - Checked By: ${checkedBy}`;
  }

  return (
    <div
      className={`p-4 rounded-2xl border transition-all ${
        isPass
          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
          : 'bg-rose-50/70 border-rose-200 text-rose-950'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-black/5">
        <div className="flex items-center gap-2">
          {isPass ? (
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertOctagon className="w-4 h-4 text-rose-600" />
          )}
          <span className="text-xs font-bold uppercase tracking-wider text-[#2B2A27]">
            Logo Check
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
              isPass
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-rose-600 text-white shadow-xs'
            }`}
          >
            {isPass ? 'PASS' : 'FAIL'}
          </span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200 flex items-center gap-1">
            {checkedBy === 'Gemini' ? (
              <Sparkles className="w-2.5 h-2.5 text-amber-500" />
            ) : (
              <Binary className="w-2.5 h-2.5 text-sky-600" />
            )}
            {checkedBy}
          </span>
        </div>
      </div>

      {/* Main Single-Line Status String */}
      <p
        className={`text-xs font-bold leading-relaxed ${
          isPass ? 'text-emerald-800' : 'text-rose-800'
        }`}
      >
        {primaryText}
      </p>

      {/* Detail Badges */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {logoCheck.location_hindi && (
          <span
            className={`px-2 py-0.5 rounded-lg border font-medium ${
              isPass
                ? 'bg-emerald-100/60 border-emerald-300/60 text-emerald-900'
                : 'bg-rose-100/60 border-rose-300/60 text-rose-900'
            }`}
          >
            📍 {logoCheck.location_hindi} ({logoCheck.location || 'unknown'})
          </span>
        )}

        {logoCheck.score !== undefined && (
          <span
            className={`px-2 py-0.5 rounded-lg border font-medium ${
              isPass
                ? 'bg-emerald-100/60 border-emerald-300/60 text-emerald-900'
                : 'bg-rose-100/60 border-rose-300/60 text-rose-900'
            }`}
          >
            🎯 Score: {scoreFormatted}
          </span>
        )}

        {logoCheck.size_percent > 0 && (
          <span
            className={`px-2 py-0.5 rounded-lg border font-medium ${
              isPass
                ? 'bg-emerald-100/60 border-emerald-300/60 text-emerald-900'
                : 'bg-rose-100/60 border-rose-300/60 text-rose-900'
            }`}
          >
            📐 Size: ~{logoCheck.size_percent}%
          </span>
        )}

        {logoCheck.reason && (
          <span
            className={`px-2 py-0.5 rounded-lg border font-mono text-[10px] font-semibold ${
              isPass
                ? 'bg-emerald-100/80 border-emerald-300 text-emerald-900'
                : 'bg-rose-100/80 border-rose-300 text-rose-900'
            }`}
          >
            Code: {logoCheck.reason}
          </span>
        )}
      </div>

      {/* Actionable Suggestion Alert for Designer if FAIL */}
      {!isPass && logoCheck.suggestion && (
        <div className="mt-2.5 p-2.5 rounded-xl bg-white/80 border border-rose-200 text-rose-900 text-xs">
          <strong className="font-bold">Designer Suggestion:</strong> {logoCheck.suggestion}
        </div>
      )}
    </div>
  );
};

export default LogoCheckCard;
