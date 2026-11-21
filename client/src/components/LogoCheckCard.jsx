import React from 'react';
import { ShieldCheck, AlertOctagon, AlertTriangle, Info, Sparkles, Binary } from 'lucide-react';

/**
 * LogoCheckCard Component
 * Displays Dedicated Brand Logo Verification Card in SMO Studio & Manager Review.
 *
 * Rules:
 * - SKIPPED: "Logo Check Skipped - Logo upload nahi hai" (Neutral, does NOT fail post)
 * - PASS: "PASS - Logo mil gaya - Neeche Right corner me hai - Score 0.94 - Checked By: Gemini"
 * - COLOR_CHANGED: "WARNING - Logo shape sahi hai par rang badal gaya hai - Score 0.88 - Checked By: Python"
 * - FAIL: "FAIL - Galat logo / Incomplete text - Checked By: Gemini/Python"
 * - Visual Side-by-Side Comparison: Brand Guidelines official logo vs candidate crop from poster.
 */
const LogoCheckCard = ({ logoCheck, aiProvider, fallbackUsed, referenceLogoUrl }) => {
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
  const isColorChanged = logoCheck.reason === 'COLOR_CHANGED';
  const checkedBy = logoCheck.checked_by || (aiProvider === 'python' || fallbackUsed ? 'Python' : 'Gemini');
  const scoreFormatted = Number(logoCheck.score || 0).toFixed(2);
  const locationHindi = logoCheck.location_hindi || 'Sahi jagah pe hai';

  // Construct standardized display text
  let primaryText = '';
  if (isColorChanged) {
    primaryText = `WARNING - Logo mil gaya lekin rang badal gaya hai - ${locationHindi} - Score ${scoreFormatted} - Checked By: ${checkedBy}`;
  } else if (isPass) {
    primaryText = `PASS - Logo mil gaya - ${locationHindi} - Score ${scoreFormatted} - Checked By: ${checkedBy}`;
  } else {
    const rawSuggestion = logoCheck.suggestion || 'Logo post me kahin nahi mila.';
    primaryText = `FAIL (RED BLOCK) - ${rawSuggestion} - Checked By: ${checkedBy}`;
  }

  // Candidate Crop & Reference Crop for Side-by-Side Comparison
  const refLogo = logoCheck.reference_crop_base64 || referenceLogoUrl || null;
  const candidateCrop = logoCheck.candidate_crop_base64 || null;

  return (
    <div
      className={`p-4 rounded-2xl border transition-all ${
        isColorChanged
          ? 'bg-amber-50/70 border-amber-300 text-amber-950'
          : isPass
          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
          : 'bg-rose-50/70 border-rose-200 text-rose-950'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-black/5">
        <div className="flex items-center gap-2">
          {isColorChanged ? (
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          ) : isPass ? (
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertOctagon className="w-4 h-4 text-rose-600" />
          )}
          <span className="text-xs font-bold uppercase tracking-wider text-[#2B2A27]">
            Brand Logo Verification
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
              isColorChanged
                ? 'bg-amber-500 text-white shadow-xs'
                : isPass
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-rose-600 text-white shadow-xs'
            }`}
          >
            {isColorChanged ? 'YELLOW ALERT' : isPass ? 'PASS' : 'RED BLOCK'}
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
          isColorChanged
            ? 'text-amber-900'
            : isPass
            ? 'text-emerald-800'
            : 'text-rose-800'
        }`}
      >
        {primaryText}
      </p>

      {/* Detail Badges */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {logoCheck.location_hindi && (
          <span
            className={`px-2 py-0.5 rounded-lg border font-medium ${
              isColorChanged
                ? 'bg-amber-100/70 border-amber-300 text-amber-900'
                : isPass
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
              isColorChanged
                ? 'bg-amber-100/70 border-amber-300 text-amber-900'
                : isPass
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
              isColorChanged
                ? 'bg-amber-100/70 border-amber-300 text-amber-900'
                : isPass
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
              isColorChanged
                ? 'bg-amber-200/80 border-amber-400 text-amber-950'
                : isPass
                ? 'bg-emerald-100/80 border-emerald-300 text-emerald-900'
                : 'bg-rose-100/80 border-rose-300 text-rose-900'
            }`}
          >
            Code: {logoCheck.reason}
          </span>
        )}
      </div>

      {/* Side-by-Side Visual Logo Comparison Box */}
      {(refLogo || candidateCrop) && (
        <div className="mt-3.5 pt-3 border-t border-black/10">
          <div className="text-[11px] font-bold text-stone-700 uppercase tracking-wide mb-2 flex items-center justify-between">
            <span>Visual Comparison (लोगो तुलना)</span>
            <span className="text-[10px] font-normal text-stone-500 lowercase">
              official guideline vs poster
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Left: Official Reference Logo */}
            <div className="bg-white p-2.5 rounded-xl border border-stone-200 text-center shadow-2xs flex flex-col items-center">
              <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
                Brand Guidelines (असली लोगो)
              </span>
              <div className="w-full h-24 flex items-center justify-center bg-stone-50/80 rounded-lg p-1.5 border border-stone-100 overflow-hidden">
                {refLogo ? (
                  <img
                    src={refLogo}
                    alt="Official Brand Reference Logo"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] text-stone-400">उपलब्ध नहीं</span>
                )}
              </div>
              <span className="mt-1.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                ✓ Official Reference
              </span>
            </div>

            {/* Right: Candidate Crop from Poster */}
            <div
              className={`p-2.5 rounded-xl border text-center shadow-2xs flex flex-col items-center ${
                isColorChanged
                  ? 'bg-amber-50/80 border-amber-300'
                  : isPass
                  ? 'bg-emerald-50/40 border-emerald-200'
                  : 'bg-rose-50/80 border-rose-300'
              }`}
            >
              <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
                पोस्टर में मिला लोगो
              </span>
              <div className="w-full h-24 flex items-center justify-center bg-white rounded-lg p-1.5 border border-stone-100 overflow-hidden">
                {candidateCrop ? (
                  <img
                    src={candidateCrop}
                    alt="Candidate Logo Extracted from Poster"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] text-stone-400">पोस्टर पर डिटेक्ट नहीं हुआ</span>
                )}
              </div>
              <span
                className={`mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                  isColorChanged
                    ? 'text-amber-800 bg-amber-100 border-amber-300'
                    : isPass
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : 'text-rose-800 bg-rose-100 border-rose-300'
                }`}
              >
                {isColorChanged
                  ? '⚠️ Color Modified'
                  : isPass
                  ? '✓ Match Confirmed'
                  : logoCheck.reason === 'WRONG_LOGO'
                  ? '✕ Wrong / Mismatch'
                  : '✕ Missing'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Actionable Suggestion Alert for Designer if FAIL */}
      {!isPass && logoCheck.suggestion && (
        <div className="mt-3 p-2.5 rounded-xl bg-white/90 border border-rose-300 text-rose-900 text-xs shadow-2xs">
          <strong className="font-bold">Designer Action Required:</strong> {logoCheck.suggestion}
        </div>
      )}
    </div>
  );
};

export default LogoCheckCard;
