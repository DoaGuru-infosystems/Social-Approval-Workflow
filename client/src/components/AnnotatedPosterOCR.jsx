import React, { useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Eye,
  Info,
  ChevronDown,
  ChevronUp,
  Maximize2,
} from 'lucide-react';

/**
 * AnnotatedPosterOCR Component
 * 
 * Replaces the monolithic raw text block with an interactive visual overlay on the poster image.
 * Renders numbered bounding boxes (1, 2, 3...) directly over detected poster regions.
 * Underneath each box, displays the 3 required lines:
 *   1. Poster me kya hai (manual)
 *   2. OCR ne kya padha (with confidence)
 *   3. Status: RED = Real Error | YELLOW = OCR Doubt | GREEN = OK
 * 
 * OCR doubts (confidence < 80% or stylized font artifacts) are classified as YELLOW and
 * NEVER counted as poster errors or used to block approval.
 */
const AnnotatedPosterOCR = ({
  imgSrc,
  boxes = [],
  ocrConfidence = 0,
  rawOcrText = '',
  realErrors = [],
}) => {
  const [selectedBoxId, setSelectedBoxId] = useState(null);
  const [showRawOcr, setShowRawOcr] = useState(false);

  // If no structured boxes provided, generate default 6 zones if poster image exists
  const displayBoxes = Array.isArray(boxes) && boxes.length > 0 ? boxes : [];

  const doubts = displayBoxes.filter((b) => b.status === 'yellow');
  const verifiedOk = displayBoxes.filter((b) => b.status === 'green');
  const errors = displayBoxes.filter((b) => b.status === 'red');

  const getStatusColor = (status) => {
    switch (status) {
      case 'red':
        return {
          border: 'border-rose-500',
          bg: 'bg-rose-500/20',
          badgeBg: 'bg-rose-600 text-white border-rose-700',
          cardBg: 'bg-rose-50/70 border-rose-200 text-rose-950',
          tagBg: 'bg-rose-100 text-rose-800 border-rose-300',
          pill: 'RED = Real Error',
        };
      case 'yellow':
        return {
          border: 'border-amber-400',
          bg: 'bg-amber-400/20',
          badgeBg: 'bg-amber-400 text-stone-900 border-amber-500',
          cardBg: 'bg-amber-50/70 border-amber-200 text-amber-950',
          tagBg: 'bg-amber-100 text-amber-800 border-amber-300',
          pill: 'YELLOW = OCR Doubt',
        };
      case 'green':
      default:
        return {
          border: 'border-emerald-500',
          bg: 'bg-emerald-500/15',
          badgeBg: 'bg-emerald-600 text-white border-emerald-700',
          cardBg: 'bg-emerald-50/60 border-emerald-200 text-emerald-950',
          tagBg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
          pill: 'GREEN = OK',
        };
    }
  };

  const handleBoxClick = (id) => {
    setSelectedBoxId((prev) => (prev === id ? null : id));
    // Scroll smoothly to card
    const cardEl = document.getElementById(`poster-box-card-${id}`);
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Header Summary Stats */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-white border border-[#E5E2DA] shadow-xs">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold text-[#2B2A27] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            PaddleOCR Visual Quality Inspection
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="px-2.5 py-0.5 rounded-full font-bold bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            🔴 Real Errors: {errors.length}
          </span>
          <span className="px-2.5 py-0.5 rounded-full font-bold bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            🟡 OCR Doubts: {doubts.length}
          </span>
          <span className="px-2.5 py-0.5 rounded-full font-bold bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            🟢 Verified OK: {verifiedOk.length}
          </span>
          {ocrConfidence > 0 && (
            <span className="px-2.5 py-0.5 rounded-full font-mono font-medium bg-stone-100 border border-[#E5E2DA] text-stone-700">
              Avg: {Math.round(ocrConfidence)}%
            </span>
          )}
        </div>
      </div>

      {/* 2. Visual Poster Canvas with Overlaid Numbered Bounding Boxes */}
      {imgSrc && (
        <div className="relative rounded-2xl overflow-hidden bg-stone-900 border border-[#E5E2DA] shadow-md group">
          {/* Main Creative Poster */}
          <img
            src={imgSrc}
            alt="Poster with PaddleOCR Annotations"
            className="w-full h-auto block select-none pointer-events-none"
            loading="lazy"
          />

          {/* Overlaid Interactive Bounding Boxes */}
          {displayBoxes.map((box) => {
            const colors = getStatusColor(box.status);
            const isSelected = selectedBoxId === box.id;
            const rect = box.rect || { left: 0, top: 0, width: 100, height: 10 };

            return (
              <div
                key={box.id}
                onClick={() => handleBoxClick(box.id)}
                title={`${box.section} - Click to inspect details`}
                style={{
                  left: `${rect.left}%`,
                  top: `${rect.top}%`,
                  width: `${rect.width}%`,
                  height: `${rect.height}%`,
                }}
                className={`absolute cursor-pointer transition-all duration-200 rounded-lg ${colors.border} ${colors.bg} ${
                  isSelected
                    ? 'border-3 ring-4 ring-white/80 shadow-2xl z-30 scale-[1.01]'
                    : 'border-2 hover:ring-2 hover:ring-white/60 z-10'
                }`}
              >
                {/* Number Badge at Top-Left */}
                <div
                  className={`absolute -top-3 -left-3 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shadow-lg border ${colors.badgeBg} transition-transform duration-150 ${
                    isSelected ? 'scale-125' : 'group-hover:scale-105'
                  }`}
                >
                  {box.id}
                </div>

                {/* Optional mini label on hover */}
                <div className="opacity-0 hover:opacity-100 transition-opacity absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-stone-900/90 text-white backdrop-blur-xs pointer-events-none">
                  {box.confidence ? `${box.confidence}%` : 'OCR'}
                </div>
              </div>
            );
          })}

          <div className="absolute bottom-2 right-2 px-2.5 py-1 rounded-lg bg-stone-900/80 text-white text-[10px] font-medium backdrop-blur-xs flex items-center gap-1.5 pointer-events-none">
            <Eye className="w-3 h-3 text-amber-400" />
            Click any numbered box to inspect details
          </div>
        </div>
      )}

      {/* 3. OCR Doubts Callout (Check Manually - Never Blame Poster) */}
      {doubts.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-amber-50/90 border border-amber-300 text-amber-950 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <h5 className="text-xs font-bold uppercase tracking-wider text-amber-900">
              Check Manually ({doubts.length} OCR Doubts - Poster is NOT penalized)
            </h5>
          </div>
          <p className="text-xs text-amber-900/90 leading-relaxed">
            PaddleOCR ne font styling ya complex character ligatures ki wajah se kuch text alag padha ho sakta hai (low OCR confidence &lt; 80%).
            Poster me ye visually verify karne ke liye inhe <strong>YELLOW OCR Doubt</strong> me rakha gaya hai, koi penalty nahi lagayi gayi.
          </p>
        </div>
      )}

      {/* 4. Real Errors Notice (Only when true errors exist) */}
      {errors.length > 0 ? (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-300 text-rose-950 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
            <h5 className="text-xs font-bold uppercase tracking-wider text-rose-900">
              Confirmed Real Poster Errors ({errors.length})
            </h5>
          </div>
          <p className="text-xs text-rose-900 leading-relaxed">
            Neeche diye gaye errors poster ke text me confirm kiye gaye hain. Kripya inhe update karein.
          </p>
        </div>
      ) : (
        <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-xs font-semibold">
            0 Real Poster Errors Detected. Poster creative is clean and legible.
          </span>
        </div>
      )}

      {/* 5. The 3-Line Cards Grid (One card per numbered box) */}
      <div className="space-y-2.5">
        <h5 className="text-xs font-bold uppercase tracking-wider text-[#6B6A63] px-1">
          Numbered Region Inspection Cards:
        </h5>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayBoxes.map((box) => {
            const colors = getStatusColor(box.status);
            const isSelected = selectedBoxId === box.id;

            return (
              <div
                id={`poster-box-card-${box.id}`}
                key={box.id}
                onClick={() => setSelectedBoxId((prev) => (prev === box.id ? null : box.id))}
                className={`p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer ${colors.cardBg} ${
                  isSelected ? 'ring-2 ring-emerald-600 shadow-md scale-[1.01]' : 'hover:shadow-xs'
                }`}
              >
                {/* Header with Number and Status */}
                <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-black/10">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shadow-xs border ${colors.badgeBg}`}
                    >
                      {box.id}
                    </span>
                    <span className="text-xs font-bold text-[#2B2A27]">{box.section}</span>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${colors.tagBg}`}
                  >
                    {box.status_label || colors.pill}
                  </span>
                </div>

                {/* THE 3 SPECIFIED LINES */}
                <div className="space-y-1.5 text-xs">
                  {/* LINE 1: Poster me kya hai (manual) */}
                  <div className="flex items-start gap-1.5">
                    <span className="font-bold text-[#2B2A27] shrink-0 min-w-32">
                      📋 Poster me kya hai:
                    </span>
                    <span className="font-medium text-[#2B2A27] leading-tight">
                      {box.poster_expected}
                    </span>
                  </div>

                  {/* LINE 2: OCR ne kya padha */}
                  <div className="flex items-start gap-1.5">
                    <span className="font-bold text-[#6B6A63] shrink-0 min-w-32">
                      🔍 OCR ne kya padha:
                    </span>
                    <div className="font-mono text-[#1E1E1E] bg-white/80 px-2 py-0.5 rounded-md border border-black/10 text-[11px] leading-tight break-all">
                      "{box.ocr_read}"
                      {box.confidence && (
                        <span className="ml-1 text-[10px] text-stone-500 font-sans">
                          ({box.confidence}%)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* LINE 3: Status */}
                  <div className="flex items-start gap-1.5 pt-0.5">
                    <span className="font-bold text-[#2B2A27] shrink-0 min-w-32">
                      🚦 Status:
                    </span>
                    <span className="font-semibold leading-tight">
                      {box.status === 'red' && (
                        <span className="text-rose-700">RED = Real Error ({box.reason})</span>
                      )}
                      {box.status === 'yellow' && (
                        <span className="text-amber-800">YELLOW = OCR Doubt ({box.reason})</span>
                      )}
                      {box.status === 'green' && (
                        <span className="text-emerald-800">GREEN = OK ({box.reason})</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 6. Collapsible Raw OCR Output (For Full Transparency) */}
      {rawOcrText && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowRawOcr(!showRawOcr)}
            className="flex items-center gap-1.5 text-xs text-[#6B6A63] hover:text-[#2B2A27] font-semibold transition-colors"
          >
            {showRawOcr ? (
              <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
            )}
            <span>{showRawOcr ? 'Hide Raw OCR Text' : 'View Full Extracted OCR Text'}</span>
          </button>

          {showRawOcr && (
            <div className="mt-2 p-3 rounded-2xl bg-stone-900 text-stone-200 font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto border border-stone-800">
              {rawOcrText}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AnnotatedPosterOCR;
